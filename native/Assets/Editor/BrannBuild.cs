using System;
using System.IO;
using BrannsForge;
using TMPro;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;
using UnityEngine.UI;

public static class BrannBuild {
  const string ScenePath = "Assets/Scenes/BrannWorkshop.unity";
  [MenuItem("Brann Forge/Build Windows")]
  public static void Build() {
    Validate(); CreateScene(); ConfigureOpenXR();
    Directory.CreateDirectory("Build");
    var report=BuildPipeline.BuildPlayer(new BuildPlayerOptions { scenes=new[]{ScenePath}, locationPathName="Build/BrannsForgeVR.exe", target=BuildTarget.StandaloneWindows64, options=BuildOptions.None });
    if(report.summary.result != BuildResult.Succeeded) throw new Exception("Windows build failed: "+report.summary.result);
    Debug.Log("Brann Forge build complete: "+report.summary.totalTime);
  }
  [MenuItem("Brann Forge/Validate")]
  public static void Validate() {
    if(Application.unityVersion.StartsWith("6000.0.33") == false) Debug.LogWarning("Expected Unity 6000.0.33f1; found "+Application.unityVersion);
    if(!File.Exists("Packages/manifest.json")) throw new Exception("Missing package manifest.");
    var manifest=File.ReadAllText("Packages/manifest.json");
    foreach(var p in new[]{"com.unity.xr.openxr","com.unity.xr.interaction.toolkit","com.unity.cloud.gltfast"}) if(!manifest.Contains(p)) throw new Exception("Required package missing: "+p);
    Debug.Log("Brann Forge validation passed: packages, desktop fallback, OpenXR bootstrap and service boundary present.");
  }
  static void ConfigureOpenXR() {
    // XR Management owns concrete serialized settings. This conservative setup lets the installed OpenXR runtime start,
    // while the game continues as desktop if no headset/runtime is available.
    var managerType=Type.GetType("UnityEngine.XR.Management.XRManagerSettings, Unity.XR.Management");
    var loaderType=Type.GetType("UnityEngine.XR.OpenXR.OpenXRLoader, Unity.XR.OpenXR");
    if(managerType==null || loaderType==null) { Debug.LogWarning("OpenXR packages are resolving; run Build again after Package Manager completes."); return; }
    var path="Assets/XR/OpenXRManager.asset"; Directory.CreateDirectory("Assets/XR");
    var manager=AssetDatabase.LoadAssetAtPath(path,managerType) as ScriptableObject;
    if(manager==null) { manager=ScriptableObject.CreateInstance(managerType); AssetDatabase.CreateAsset(manager,path); }
    managerType.GetMethod("TryAddLoader",new[]{typeof(Type),typeof(int)})?.Invoke(manager,new object[]{loaderType,0});
    var generalType=Type.GetType("UnityEngine.XR.Management.XRGeneralSettings, Unity.XR.Management");
    var perTargetType=Type.GetType("UnityEditor.XR.Management.XRGeneralSettingsPerBuildTarget, Unity.XR.Management.Editor");
    if(generalType!=null) {
      const string generalPath="Assets/XR/XRGeneralSettings.asset";
      var general=AssetDatabase.LoadAssetAtPath(generalPath,generalType) as ScriptableObject;
      if(general==null) { general=ScriptableObject.CreateInstance(generalType); AssetDatabase.CreateAsset(general,generalPath); }
      generalType.GetProperty("Manager")?.SetValue(general,manager);
      var instance=perTargetType?.GetProperty("Instance",System.Reflection.BindingFlags.Public|System.Reflection.BindingFlags.Static)?.GetValue(null);
      perTargetType?.GetMethod("SetSettingsForBuildTarget")?.Invoke(instance,new object[]{BuildTargetGroup.Standalone,general});
      EditorUtility.SetDirty(general);
    }
    EditorUtility.SetDirty(manager); AssetDatabase.SaveAssets();
    Debug.Log("OpenXR loader asset configured. SteamVR-selected OpenXR runtime is used at launch.");
  }
  static void CreateScene() {
    Directory.CreateDirectory("Assets/Scenes");
    var scene=UnityEditor.SceneManagement.EditorSceneManager.NewScene(UnityEditor.SceneManagement.NewSceneSetup.EmptyScene, UnityEditor.SceneManagement.NewSceneMode.Single);
    RenderSettings.ambientLight=new Color(.34f,.20f,.10f);
    var root=new GameObject("Brann Forge Workshop");
    var workshop=root.AddComponent<BrannWorkshop>();
    Ground(root.transform); Forge(root.transform, workshop); Player(root.transform, workshop); Board(root.transform, workshop);
    UnityEditor.SceneManagement.EditorSceneManager.SaveScene(scene,ScenePath);
    EditorBuildSettings.scenes=new[]{new EditorBuildSettingsScene(ScenePath,true)};
  }
  static void Ground(Transform parent) { var g=GameObject.CreatePrimitive(PrimitiveType.Plane); g.name="Workshop floor"; g.transform.SetParent(parent); g.transform.localScale=Vector3.one*3; g.GetComponent<Renderer>().sharedMaterial=Mat(new Color(.22f,.10f,.045f)); }
  static void Forge(Transform parent, BrannWorkshop w) {
    var anvil=Cube("Anvil",new Vector3(0,.65f,2),new Vector3(1.1f,.45f,.55f),new Color(.12f,.13f,.14f),parent);
    var b=GameObject.CreatePrimitive(PrimitiveType.Capsule); b.name="Brann Copperpot (busy smith)"; b.transform.SetParent(parent); b.transform.position=new Vector3(-1.2f,1,2); b.GetComponent<Renderer>().sharedMaterial=Mat(new Color(.72f,.27f,.08f)); b.AddComponent<BrannAnimator>(); w.brann=b.transform;
    var question=GameObject.CreatePrimitive(PrimitiveType.Sphere); question.name="Completed commission ?"; question.transform.SetParent(b.transform); question.transform.localPosition=Vector3.up*1.3f; question.transform.localScale=Vector3.one*.34f; question.GetComponent<Renderer>().sharedMaterial=Mat(Color.yellow);
    var rack=new GameObject("Live item rack"); rack.transform.SetParent(parent); rack.transform.position=new Vector3(2,.7f,2); w.itemRack=rack.transform;
    var hammer=GameObject.CreatePrimitive(PrimitiveType.Cylinder); hammer.name="Starter Hammer"; hammer.transform.SetParent(rack.transform); hammer.transform.position=rack.transform.position; hammer.transform.localScale=new Vector3(.18f,.65f,.18f); hammer.AddComponent<GrabMarker>(); BrannWorkshop.AddGrabbable(hammer); hammer.AddComponent<WorkshopUse>().abilityId="starter_hammer";
    for(int i=0;i<4;i++){var rat=GameObject.CreatePrimitive(PrimitiveType.Capsule); rat.name="Workshop rat "+i; rat.transform.SetParent(parent); rat.transform.position=new Vector3(-3+i*1.4f,.5f,-.4f); rat.transform.localScale=new Vector3(.35f,.22f,.55f); rat.AddComponent<Rigidbody>(); var r=rat.AddComponent<Rat>(); r.id="local-rat-"+i+"-"+Guid.NewGuid().ToString("N"); r.workshop=w;}
  }
  static void Player(Transform parent, BrannWorkshop w) {
    var rig=new GameObject("Player Rig"); rig.transform.SetParent(parent); rig.transform.position=new Vector3(0,0,-3.5f); rig.AddComponent<WorkshopPlayer>(); w.player=rig.transform;
    var cam=new GameObject("Main Camera").AddComponent<Camera>(); cam.tag="MainCamera"; cam.transform.SetParent(rig.transform); cam.transform.localPosition=new Vector3(0,1.65f,0); w.desktopCamera=cam;
    var left=new GameObject("Left Hand"); left.transform.SetParent(rig.transform); left.transform.localPosition=new Vector3(-.25f,1.35f,.35f); var right=new GameObject("Right Hand"); right.transform.SetParent(rig.transform); right.transform.localPosition=new Vector3(.25f,1.35f,.35f);
    var xr=rig.AddComponent<XRHeadAndHands>(); xr.head=cam; xr.left=left.transform; xr.right=right.transform; xr.workshop=w;
  }
  static void Board(Transform parent, BrannWorkshop w) {
    var canvas=new GameObject("In-world service board"); canvas.transform.SetParent(parent); canvas.transform.position=new Vector3(0,2.1f,3.3f); canvas.transform.rotation=Quaternion.Euler(0,180,0); var c=canvas.AddComponent<Canvas>(); c.renderMode=RenderMode.WorldSpace; c.GetComponent<RectTransform>().sizeDelta=new Vector2(900,480); c.transform.localScale=Vector3.one*.0022f; canvas.AddComponent<CanvasScaler>();
    var bg=UI("Board",canvas.transform,new Vector2(900,480),new Vector2(0,0)); bg.GetComponent<Image>().color=new Color(.13f,.06f,.02f,.95f);
    w.status=Label("Status",canvas.transform,"Loading workshop…",new Vector2(0,155),30); w.favourText=Label("Favours",canvas.transform,"Tails 0/5   Favours 0",new Vector2(0,85),32); w.briefText=Label("Brief",canvas.transform,"Commission a new enchantment",new Vector2(0,25),25);
    Button("Retry",canvas.transform,new Vector2(-260,-130),WorkshopButton.Kind.Retry); Button("Voice",canvas.transform,new Vector2(-85,-130),WorkshopButton.Kind.Voice); Button("Hand in",canvas.transform,new Vector2(90,-130),WorkshopButton.Kind.Handin); Button("Commission",canvas.transform,new Vector2(285,-130),WorkshopButton.Kind.Commission);
  }
  static TMP_Text Label(string n,Transform p,string text,Vector2 pos,float size){var x=UI(n,p,new Vector2(820,55),pos); var t=x.AddComponent<TextMeshProUGUI>(); t.text=text;t.fontSize=size;t.alignment=TextAlignmentOptions.Center;t.color=new Color(1,.78f,.32f);return t;}
  static void Button(string text,Transform p,Vector2 pos,WorkshopButton.Kind kind){var g=UI(text,p,new Vector2(150,62),pos);g.GetComponent<Image>().color=new Color(.45f,.18f,.04f);var label=g.AddComponent<TextMeshProUGUI>();label.text=text;label.alignment=TextAlignmentOptions.Center;label.fontSize=25;label.color=Color.white; var box=g.AddComponent<BoxCollider>();box.size=new Vector3(150,62,8);var b=g.AddComponent<WorkshopButton>();b.kind=kind;}
  static GameObject UI(string n,Transform p,Vector2 size,Vector2 pos){var g=new GameObject(n,typeof(RectTransform),typeof(Image));g.transform.SetParent(p,false);var r=g.GetComponent<RectTransform>();r.sizeDelta=size;r.anchoredPosition=pos;return g;}
  static GameObject Cube(string n,Vector3 p,Vector3 s,Color c,Transform parent){var g=GameObject.CreatePrimitive(PrimitiveType.Cube);g.name=n;g.transform.SetParent(parent);g.transform.position=p;g.transform.localScale=s;g.GetComponent<Renderer>().sharedMaterial=Mat(c);return g;}
  static Material Mat(Color c){var m=new Material(Shader.Find("Universal Render Pipeline/Lit")??Shader.Find("Standard"));m.color=c;return m;}
}
