using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Threading.Tasks;
using GLTFast;
using TMPro;
using UnityEngine;
using UnityEngine.Networking;
using UnityEngine.XR;
using UnityEngine.XR.Interaction.Toolkit.Interactables;

namespace BrannsForge {
  [Serializable] public class VrItem { public string id, name, description, color, modelUrl; public float cooldown; }
  [Serializable] public class VrJob { public string id, status, stage; }
  [Serializable] public class VrVoice { public bool enabled; public string voice; public int revision; }
  [Serializable] public class VrState { public int tails, favours; public VrItem[] items; public VrJob[] jobs; public VrVoice voice; public bool visiting, configured; }
  [Serializable] public class ErrorReply { public string error; }
  [Serializable] public class ActionReply { public AbilityAction[] actions; public float cooldown; }
  [Serializable] public class AbilityAction { public string type, color; public float x, y, z, duration; }

  public class BrannWorkshop : MonoBehaviour {
    public const string Service = "http://127.0.0.1:8787";
    static readonly string[] Voices = { "vesper", "ripple", "stone", "meridian", "cinder", "marin", "willow", "quartz" };
    public Transform player, brann, itemRack;
    public TMP_Text status, briefText, favourText;
    public Camera desktopCamera;
    readonly Dictionary<string, GameObject> liveItems = new Dictionary<string, GameObject>();
    readonly Dictionary<string, GltfImport> importers = new Dictionary<string, GltfImport>(); // imports own native buffers for their whole equipped lifetime
    readonly HashSet<string> pendingImports = new HashSet<string>();
    readonly HashSet<string> reportedKills = new HashSet<string>();
    readonly HashSet<string> confirmedKills = new HashSet<string>();
    readonly HashSet<string> pendingTails = new HashSet<string>();
    readonly Dictionary<string, Tail> waitingForKill = new Dictionary<string, Tail>();
    VrState state; bool online, statusIsError, openedVoice; int autoVoiceRevision = -1; float nextPoll, nextContext, nextUse; string equippedId = "";

    void Start() { SetStatus("Workshop ready — server checking…"); StartCoroutine(PollState()); }
    void Update() {
      if (Time.time >= nextPoll) { nextPoll = Time.time + 5f; StartCoroutine(PollState()); }
      if (Time.time >= nextContext) { nextContext = Time.time + 1f; StartCoroutine(SendContext()); }
      if (desktopCamera != null && !XRSettings.isDeviceActive) DesktopInput();
      if (player != null && brann != null && Vector3.Distance(player.position, brann.position) < 2.2f && Input.GetKeyDown(KeyCode.H)) RequestHandIn();
    }
    void DesktopInput() {
      Transform t = desktopCamera.transform, rig = t.parent;
      Vector3 flat = Vector3.ProjectOnPlane(t.forward, Vector3.up).normalized;
      rig.position += (flat * Input.GetAxisRaw("Vertical") + Vector3.ProjectOnPlane(t.right, Vector3.up).normalized * Input.GetAxisRaw("Horizontal")) * 3.4f * Time.deltaTime;
      if (Input.GetMouseButton(1)) { rig.Rotate(0, Input.GetAxis("Mouse X") * 3f, 0); t.Rotate(-Input.GetAxis("Mouse Y") * 2f, 0, 0); }
      if (Input.GetMouseButton(0)) RayUse(t, 5f);
      if (Input.GetKeyDown(KeyCode.E)) DesktopGrabOrDrop(t);
      if (Input.GetKeyDown(KeyCode.Q)) rig.Rotate(0, -30, 0);
      if (Input.GetKeyDown(KeyCode.R)) rig.Rotate(0, 30, 0);
      if (Input.GetKeyDown(KeyCode.T)) TeleportTo(new Vector3(0, 0, -3.5f));
    }
    void DesktopGrabOrDrop(Transform t) {
      var hand = GetComponent<XRHeadAndHands>(); if (hand != null) { hand.DesktopGrip(t); return; }
      if (Physics.Raycast(t.position, t.forward, out RaycastHit hit, 1.5f)) TryCollectTail(hit.collider.GetComponentInParent<Tail>());
    }
    public void RayUse(Transform origin, float distance) {
      if (Time.time < nextUse) return;
      nextUse = Time.time + .2f;
      if (Physics.Raycast(origin.position, origin.forward, out RaycastHit hit, distance)) {
        if (hit.collider.GetComponentInParent<WorkshopButton>() is WorkshopButton button) button.Click(this);
        else if (equippedId == "starter_hammer") UseStarter(origin.position, origin.forward);
        else if (!string.IsNullOrEmpty(equippedId)) UseAbility(equippedId, origin.position, origin.forward);
      } else if (equippedId == "starter_hammer") UseStarter(origin.position, origin.forward);
      else if (!string.IsNullOrEmpty(equippedId)) UseAbility(equippedId, origin.position, origin.forward);
    }
    public void SetStatus(string message, bool error = false) { statusIsError = error; if (status != null) status.text = message; }
    public void SubmitCommission(string brief) { if (!string.IsNullOrWhiteSpace(brief)) StartCoroutine(Post("/api/vr/commission", "{\"brief\":" + Json(brief) + "}", _ => { SetStatus("Commission sent to the forge."); StartCoroutine(PollState()); })); }
    public void PromptCommission() { SetStatus("Tell Brann your commission in the companion, then return here."); Application.OpenURL(Service + "/voice"); }
    public void CycleVoice() {
      int at = Array.IndexOf(Voices, state?.voice?.voice); string voice = Voices[(at + 1 + Voices.Length) % Voices.Length];
      StartCoroutine(Post("/api/vr/voice", "{\"enabled\":true,\"voice\":" + Json(voice) + "}", _ => { SetStatus("Voice: " + voice); StartCoroutine(PollState()); }));
    }
    public void ToggleVoice(bool enabled) { string voice = state?.voice?.voice; if (Array.IndexOf(Voices, voice) < 0) voice = Voices[0]; StartCoroutine(Post("/api/vr/voice", "{\"enabled\":" + enabled.ToString().ToLowerInvariant() + ",\"voice\":" + Json(voice) + "}", _ => SetStatus(enabled ? "Voice companion enabled." : "Voice companion disabled."))); }
    public void Retry() { StartCoroutine(PollState()); if (state != null) ToggleVoice(true); Application.OpenURL(Service + "/voice"); }
    IEnumerator PollState() {
      using (var request = UnityWebRequest.Get(Service + "/api/vr/state")) {
        request.timeout = 3; yield return request.SendWebRequest();
        if (request.result != UnityWebRequest.Result.Success) { online = false; if (!statusIsError) SetStatus("Service offline — starter hammer remains playable locally.", true); yield break; }
        online = true; state = JsonUtility.FromJson<VrState>(request.downloadHandler.text); UpdateUi();
        if (state.items != null) foreach (VrItem item in state.items) if (!liveItems.ContainsKey(item.id) && pendingImports.Add(item.id)) LoadLiveItem(item);
        if (state.visiting && state.voice != null && !state.voice.enabled && autoVoiceRevision != state.voice.revision) { autoVoiceRevision = state.voice.revision; ToggleVoice(true); }
        if (!openedVoice && state.visiting && state.voice != null && state.voice.enabled) { openedVoice = true; Application.OpenURL(Service + "/voice"); }
      }
    }
    void UpdateUi() {
      if (state == null) return;
      if (favourText != null) favourText.text = "Tails " + state.tails + "/5   Favours " + state.favours;
      bool hasReady = state.jobs != null && Array.Exists(state.jobs, j => j.status == "ready");
      bool busy = state.jobs != null && Array.Exists(state.jobs, j => j.status == "queued" || j.status == "building" || j.status == "validating");
      if (briefText != null) briefText.text = "Voice: " + (state.voice?.voice ?? Voices[0]) + "  •  " + (busy ? "Forge " + FirstStage() : hasReady ? "A commission is ready on the rack" : "Speak to Brann to commission");
      foreach (WorkshopButton button in FindObjectsByType<WorkshopButton>(FindObjectsSortMode.None)) if (button.kind == WorkshopButton.Kind.Voice && button.TryGetComponent<TMP_Text>(out TMP_Text label)) label.text = "Voice: " + (state.voice?.voice ?? Voices[0]);
      if (brann != null) {
        BrannAnimator smith = brann.GetComponent<BrannAnimator>(); if (smith != null) smith.busy = busy;
        Transform marker = brann.Find("Completed commission ?"); if (marker != null) marker.gameObject.SetActive((state.tails >= 5) || hasReady);
      }
      if (!statusIsError) SetStatus(state.configured ? "Forge connected" : "Forge connected — voice companion is not configured");
    }
    string FirstStage() { foreach (VrJob j in state.jobs) if (j.status == "queued" || j.status == "building" || j.status == "validating") return j.stage; return "working"; }
    IEnumerator SendContext() {
      if (!online || player == null) yield break;
      Vector3 p = player.position;
      yield return Post("/api/vr/context", "{\"position\":" + Vec(p) + ",\"equipped\":" + Json(equippedId) + ",\"visiting\":" + (brann != null && Vector3.Distance(p, brann.position) < 2.2f).ToString().ToLowerInvariant() + ",\"targets\":" + TargetsJson() + "}", null);
    }
    string TargetsJson() {
      StringBuilder b = new StringBuilder("["); bool first = true;
      foreach (Rat rat in FindObjectsByType<Rat>(FindObjectsSortMode.None)) if (rat != null && rat.isActiveAndEnabled) AddTarget(b, ref first, rat.id, "rat", rat.transform.position, rat.Alive);
      foreach (TestDummy dummy in FindObjectsByType<TestDummy>(FindObjectsSortMode.None)) if (dummy != null && dummy.isActiveAndEnabled) AddTarget(b, ref first, dummy.Id, "dummy", dummy.transform.position, dummy.Alive);
      return b.Append(']').ToString();
    }
    static void AddTarget(StringBuilder b, ref bool first, string id, string type, Vector3 p, bool alive) { if (string.IsNullOrEmpty(id)) return; if (!first) b.Append(','); first = false; b.Append("{\"id\":").Append(Json(id)).Append(",\"type\":").Append(Json(type)).Append(",\"alive\":").Append(alive ? "true" : "false").Append(",\"x\":").Append(F(p.x)).Append(",\"y\":").Append(F(p.y)).Append(",\"z\":").Append(F(p.z)).Append('}'); }
    public void Equip(GameObject item, string id) { equippedId = id ?? ""; SetStatus(string.IsNullOrEmpty(equippedId) ? "Hands free." : "Equipped " + equippedId + "."); }
    public void ClearEquipped(GameObject item) { if (item != null && item.GetComponent<WorkshopUse>()?.abilityId == equippedId) equippedId = ""; }
    public void RatKilled(string id) {
      if (string.IsNullOrEmpty(id) || !reportedKills.Add(id)) return;
      StartCoroutine(Post("/api/vr/kill", "{\"id\":" + Json(id) + "}", _ => {
        confirmedKills.Add(id); SetStatus("Rat felled — grip its tail to collect it.");
        if (waitingForKill.TryGetValue(id, out Tail waiting)) { waitingForKill.Remove(id); TryCollectTail(waiting); }
      }));
    }
    public void TryCollectTail(Tail tail) {
      if (tail == null || tail.Collected || pendingTails.Contains(tail.id)) return;
      if (!confirmedKills.Contains(tail.id)) { waitingForKill[tail.id] = tail; SetStatus("Registering the hunt before collecting its tail."); return; }
      pendingTails.Add(tail.id); StartCoroutine(Post("/api/vr/tail", "{\"id\":" + Json(tail.id) + "}", _ => { pendingTails.Remove(tail.id); tail.MarkCollected(); SetStatus("Tail collected."); StartCoroutine(PollState()); }, () => pendingTails.Remove(tail.id)));
    }
    public void RespawnRat(Vector3 kitchenHome) { StartCoroutine(RespawnRatLater(kitchenHome)); }
    IEnumerator RespawnRatLater(Vector3 kitchenHome) { yield return new WaitForSeconds(9f); GameObject rat = GameObject.CreatePrimitive(PrimitiveType.Capsule); rat.name = "Kitchen rat"; rat.transform.position = kitchenHome; rat.transform.localScale = new Vector3(.35f, .22f, .55f); rat.AddComponent<Rigidbody>(); Rat behaviour = rat.AddComponent<Rat>(); behaviour.id = "rat-" + Guid.NewGuid().ToString("N"); behaviour.workshop = this; }
    public void RequestHandIn() { if (player != null && brann != null && Vector3.Distance(player.position, brann.position) < 2.2f) StartCoroutine(HandIn()); else SetStatus("Bring five tails to Brann before handing in.", true); }
    IEnumerator HandIn() { yield return Post("/api/vr/handin", "{}", _ => { SetStatus("Brann accepts the tails."); StartCoroutine(PollState()); }); }
    public void UseEquipped(Vector3 position, Vector3 forward) { if (equippedId == "starter_hammer") UseStarter(position, forward); else if (!string.IsNullOrEmpty(equippedId)) UseAbility(equippedId, position, forward); }
    void UseStarter(Vector3 position, Vector3 forward) { if (Physics.Raycast(position, forward, out RaycastHit hit, 3f)) { Rat rat = hit.collider.GetComponentInParent<Rat>(); if (rat != null) rat.ReceiveWeaponHit(); TestDummy dummy = hit.collider.GetComponentInParent<TestDummy>(); if (dummy != null) dummy.Hit(); } SetStatus("Starter hammer swung."); }
    public void UseAbility(string id, Vector3 position, Vector3 forward) { if (!online || string.IsNullOrEmpty(id) || id != equippedId) return; StartCoroutine(Post("/api/vr/ability", "{\"id\":" + Json(id) + ",\"position\":" + Vec(position) + ",\"forward\":" + Vec(forward.normalized) + ",\"targets\":" + TargetsJson() + "}", ApplyAbility)); }
    void ApplyAbility(string json) { ActionReply reply = JsonUtility.FromJson<ActionReply>(json); if (reply?.actions == null) return; foreach (AbilityAction a in reply.actions) ExecuteAction(a); }
    void ExecuteAction(AbilityAction a) {
      Vector3 p = new Vector3(a.x, a.y, a.z); float seconds = Mathf.Max(.01f, a.duration / 1000f);
      switch (a.type) {
        case "blast": DamageAt(p, 1.5f); StartCoroutine(Effect(p, a.color, seconds, 1f)); break;
        case "slow": foreach (TestDummy d in Near<TestDummy>(p, 2f)) d.Slow(seconds); StartCoroutine(Effect(p, a.color, seconds, .65f)); break;
        case "pull": foreach (Rigidbody body in Physics.OverlapSphere(p, 2.5f).SelectBodies()) body.AddForce((p - body.worldCenterOfMass).normalized * 6f, ForceMode.VelocityChange); StartCoroutine(Effect(p, a.color, seconds, .5f)); break;
        case "shield": StartCoroutine(Shield(seconds, a.color)); break;
        case "dash": TeleportTo(new Vector3(p.x, player != null ? player.position.y : p.y, p.z)); break;
        case "bomb": StartCoroutine(DelayedBomb(p, a.color, seconds)); break;
        case "spark": StartCoroutine(Effect(p, a.color, seconds, .25f)); break;
      }
    }
    IEnumerable<T> Near<T>(Vector3 point, float radius) where T : Component { foreach (T c in FindObjectsByType<T>(FindObjectsSortMode.None)) if (Vector3.Distance(c.transform.position, point) <= radius) yield return c; }
    void DamageAt(Vector3 p, float radius) { foreach (Rat r in Near<Rat>(p, radius)) r.ReceiveWeaponHit(); foreach (TestDummy d in Near<TestDummy>(p, radius)) d.Hit(); }
    IEnumerator DelayedBomb(Vector3 p, string color, float seconds) { yield return new WaitForSeconds(seconds); DamageAt(p, 2.5f); yield return Effect(p, color, .4f, 1.5f); }
    IEnumerator Shield(float seconds, string color) { if (player == null) yield break; GameObject shield = GameObject.CreatePrimitive(PrimitiveType.Sphere); shield.name = "Forged shield"; shield.transform.SetParent(player); shield.transform.localPosition = Vector3.up; shield.transform.localScale = Vector3.one * 2f; Destroy(shield.GetComponent<Collider>()); yield return Effect(shield.transform.position, color, seconds, 2f, shield); }
    IEnumerator Effect(Vector3 p, string hex, float seconds, float size, GameObject existing = null) { GameObject go = existing ?? GameObject.CreatePrimitive(PrimitiveType.Sphere); if (existing == null) go.transform.position = p; go.transform.localScale = Vector3.one * size; Collider col = go.GetComponent<Collider>(); if (col != null) Destroy(col); Color color = Color.yellow; ColorUtility.TryParseHtmlString(hex, out color); Renderer renderer = go.GetComponent<Renderer>(); if (renderer != null) renderer.material.color = color; Destroy(go, seconds); yield return null; }
    async void LoadLiveItem(VrItem item) {
      try {
        if (string.IsNullOrWhiteSpace(item.modelUrl) || itemRack == null) { SetStatus("Ready item has no model URL.", true); return; }
        GltfImport importer = new GltfImport();
        if (!await importer.Load(item.modelUrl)) { SetStatus("Could not load ready item " + item.name + ".", true); return; }
        GameObject root = new GameObject("LiveItem_" + item.id); root.transform.SetParent(itemRack, false); root.transform.position = itemRack.position + Vector3.right * liveItems.Count * .55f;
        if (!await importer.InstantiateMainSceneAsync(root.transform)) { Destroy(root); SetStatus("Could not instantiate ready item " + item.name + ".", true); return; }
        ScaleToGrip(root); AddGrabbable(root); WorkshopUse use = root.AddComponent<WorkshopUse>(); use.abilityId = item.id;
        liveItems[item.id] = root; importers[item.id] = importer; SetStatus(item.name + " is ready on the rack.");
      } catch (Exception e) { SetStatus("Ready item import failed: " + e.Message, true); }
      finally { pendingImports.Remove(item.id); }
    }
    static void ScaleToGrip(GameObject root) { Renderer[] rs = root.GetComponentsInChildren<Renderer>(); if (rs.Length == 0) return; Bounds bounds = rs[0].bounds; for (int i = 1; i < rs.Length; i++) bounds.Encapsulate(rs[i].bounds); float longest = Mathf.Max(bounds.size.x, bounds.size.y, bounds.size.z); if (longest > .001f) root.transform.localScale *= Mathf.Clamp(.7f / longest, .05f, 10f); }
    public static void AddGrabbable(GameObject go) { Bounds bounds = new Bounds(go.transform.position, Vector3.one * .2f); Renderer[] rs = go.GetComponentsInChildren<Renderer>(); if (rs.Length > 0) { bounds = rs[0].bounds; for (int i = 1; i < rs.Length; i++) bounds.Encapsulate(rs[i].bounds); } BoxCollider box = go.GetComponent<BoxCollider>() ?? go.AddComponent<BoxCollider>(); box.center = go.transform.InverseTransformPoint(bounds.center); box.size = go.transform.InverseTransformVector(bounds.size); Rigidbody body = go.GetComponent<Rigidbody>() ?? go.AddComponent<Rigidbody>(); body.mass = .8f; if (!go.GetComponent<GrabMarker>()) go.AddComponent<GrabMarker>(); if (!go.GetComponent<XRGrabInteractable>()) go.AddComponent<XRGrabInteractable>(); }
    public void TeleportTo(Vector3 destination) { if (player == null || destination.x < -5.8f || destination.x > 5.8f || destination.z < -5.8f || destination.z > 5.8f) return; if (Physics.Raycast(destination + Vector3.up * 3f, Vector3.down, out RaycastHit floor, 6f)) destination.y = floor.point.y; player.position = destination; }
    IEnumerator Post(string path, string body, Action<string> done, Action failed = null) { using (var request = new UnityWebRequest(Service + path, "POST")) { request.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(body)); request.downloadHandler = new DownloadHandlerBuffer(); request.SetRequestHeader("Content-Type", "application/json"); request.timeout = 3; yield return request.SendWebRequest(); if (request.result == UnityWebRequest.Result.Success) { online = true; done?.Invoke(request.downloadHandler.text); } else { online = false; ErrorReply error = JsonUtility.FromJson<ErrorReply>(request.downloadHandler?.text ?? ""); SetStatus(!string.IsNullOrEmpty(error?.error) ? error.error : "Service unavailable — no server progress was recorded.", true); failed?.Invoke(); } } }
    static string F(float value) => value.ToString("R", CultureInfo.InvariantCulture);
    static string Json(string s) => "\"" + (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", "\\n").Replace("\r", "\\r") + "\"";
    static string Vec(Vector3 v) => "{\"x\":" + F(v.x) + ",\"y\":" + F(v.y) + ",\"z\":" + F(v.z) + "}";
  }

  static class ColliderBodies { public static IEnumerable<Rigidbody> SelectBodies(this Collider[] colliders) { HashSet<Rigidbody> found = new HashSet<Rigidbody>(); foreach (Collider c in colliders) if (c.attachedRigidbody != null && found.Add(c.attachedRigidbody)) yield return c.attachedRigidbody; } }
  public class WorkshopUse : MonoBehaviour { public string abilityId; void OnCollisionEnter(Collision collision) { if (abilityId == "starter_hammer" && collision.relativeVelocity.magnitude > 1.2f) collision.collider.GetComponentInParent<Rat>()?.ReceiveWeaponHit(); } }
  public class Rat : MonoBehaviour { public string id; public BrannWorkshop workshop; bool dead; Vector3 home; public bool Alive => !dead; void Start() { home = transform.position; StartCoroutine(Roam()); } IEnumerator Roam() { while (!dead) { Vector3 goal = home + new Vector3(UnityEngine.Random.Range(-1.2f, 1.2f), 0, UnityEngine.Random.Range(-1.2f, 1.2f)); float until = Time.time + UnityEngine.Random.Range(1f, 3f); while (!dead && Time.time < until) { transform.position = Vector3.MoveTowards(transform.position, goal, .35f * Time.deltaTime); yield return null; } } } public void ReceiveWeaponHit() { if (dead) return; dead = true; workshop?.RatKilled(id); workshop?.RespawnRat(home); GameObject tail = GameObject.CreatePrimitive(PrimitiveType.Capsule); tail.name = "Tail_" + id; tail.transform.position = transform.position + Vector3.up * .2f; BrannWorkshop.AddGrabbable(tail); Tail pickup = tail.AddComponent<Tail>(); pickup.id = id; pickup.workshop = workshop; Destroy(gameObject); } }
  public class Tail : MonoBehaviour { public string id; public BrannWorkshop workshop; public bool Collected { get; private set; } public void MarkCollected() { if (Collected) return; Collected = true; Destroy(gameObject); } }
  public class TestDummy : MonoBehaviour { public string Id = "dummy"; public bool Alive = true; Renderer visual; void Awake() { visual = GetComponentInChildren<Renderer>(); } public void Hit() { if (!Alive) return; StartCoroutine(Flash(Color.red, .18f)); } public void Slow(float seconds) { StartCoroutine(Flash(Color.cyan, seconds)); } IEnumerator Flash(Color color, float seconds) { if (visual == null) yield break; Color baseColor = visual.material.color; visual.material.color = color; yield return new WaitForSeconds(seconds); if (visual != null) visual.material.color = baseColor; } }
  public class WorkshopPlayer : MonoBehaviour { }
  public class BrannAnimator : MonoBehaviour { public bool busy = true; public Transform arm; Vector3 basePos; Quaternion armBase; void Start() { basePos = transform.localPosition; if (arm != null) armBase = arm.localRotation; } void Update() { if (busy) { transform.localPosition = basePos + Vector3.up * Mathf.Abs(Mathf.Sin(Time.time * 4)) * .04f; if (arm != null) arm.localRotation = armBase * Quaternion.Euler(Mathf.Sin(Time.time * 8) * 35, 0, 0); } else { transform.localPosition = basePos; if (arm != null) arm.localRotation = armBase; } } }
}
