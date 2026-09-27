using UnityEngine;
using UnityEngine.XR;

namespace BrannsForge {
  public class XRHeadAndHands : MonoBehaviour {
    public Camera head; public Transform left, right; public BrannWorkshop workshop;
    GameObject heldLeft, heldRight; bool lastLeftTrigger, lastRightTrigger, lastLeftGrip, lastRightGrip, lastTeleport; float nextTurn;
    void Update() {
      if (head != null) UpdatePose(XRNode.Head, head.transform);
      UpdateHand(XRNode.LeftHand, left, ref heldLeft, ref lastLeftTrigger, ref lastLeftGrip);
      UpdateHand(XRNode.RightHand, right, ref heldRight, ref lastRightTrigger, ref lastRightGrip);
      HandleLocomotion();
    }
    void UpdatePose(XRNode node, Transform transform) { var device = InputDevices.GetDeviceAtXRNode(node); if (!device.isValid || transform == null) return; if (device.TryGetFeatureValue(CommonUsages.devicePosition, out Vector3 p)) transform.localPosition = p; if (device.TryGetFeatureValue(CommonUsages.deviceRotation, out Quaternion q)) transform.localRotation = q; }
    void UpdateHand(XRNode node, Transform hand, ref GameObject held, ref bool lastTrigger, ref bool lastGrip) {
      if (hand == null) return; UpdatePose(node, hand); var device = InputDevices.GetDeviceAtXRNode(node); if (!device.isValid) return;
      device.TryGetFeatureValue(CommonUsages.gripButton, out bool grip); device.TryGetFeatureValue(CommonUsages.triggerButton, out bool trigger);
      if (grip && !lastGrip) Grab(hand, ref held); if (!grip && lastGrip) Drop(hand, ref held);
      if (trigger && !lastTrigger) { if (Physics.Raycast(hand.position, hand.forward, out RaycastHit hit, 5f) && hit.collider.GetComponentInParent<WorkshopButton>() is WorkshopButton button) button.Click(workshop); else workshop?.UseEquipped(hand.position, hand.forward); }
      lastGrip = grip; lastTrigger = trigger;
    }
    void Grab(Transform hand, ref GameObject held) { if (held != null || !Physics.Raycast(hand.position, hand.forward, out RaycastHit hit, 1.2f)) return; GrabMarker marker = hit.collider.GetComponentInParent<GrabMarker>(); if (marker == null) return; held = marker.gameObject; Rigidbody body = held.GetComponent<Rigidbody>(); if (body != null) body.isKinematic = true; held.transform.SetParent(hand, true); WorkshopUse use = held.GetComponent<WorkshopUse>(); if (use != null) workshop?.Equip(held, use.abilityId); Tail tail = held.GetComponent<Tail>(); if (tail != null) workshop?.TryCollectTail(tail); }
    void Drop(Transform hand, ref GameObject held) { if (held == null) return; workshop?.ClearEquipped(held); held.transform.SetParent(null, true); Rigidbody body = held.GetComponent<Rigidbody>(); if (body != null) { body.isKinematic = false; body.linearVelocity = hand.forward * 1.5f; } held = null; }
    public void DesktopGrip(Transform view) { if (heldRight != null) { Drop(view, ref heldRight); return; } if (Physics.Raycast(view.position, view.forward, out RaycastHit hit, 1.5f)) { Tail tail = hit.collider.GetComponentInParent<Tail>(); if (tail != null) { workshop?.TryCollectTail(tail); return; } Grab(view, ref heldRight); } }
    void HandleLocomotion() {
      var leftDevice = InputDevices.GetDeviceAtXRNode(XRNode.LeftHand); if (leftDevice.isValid && leftDevice.TryGetFeatureValue(CommonUsages.primary2DAxisClick, out bool leftClick) && leftClick && !lastTeleport && left != null && Physics.Raycast(left.position, left.forward, out RaycastHit floor, 8f)) workshop?.TeleportTo(floor.point); lastTeleport = leftClick;
      var rightDevice = InputDevices.GetDeviceAtXRNode(XRNode.RightHand); if (rightDevice.isValid && rightDevice.TryGetFeatureValue(CommonUsages.primary2DAxis, out Vector2 axis) && Mathf.Abs(axis.x) > .8f && Time.time > nextTurn) { transform.Rotate(0, axis.x > 0 ? 30 : -30, 0); nextTurn = Time.time + .35f; }
    }
  }
  public class GrabMarker : MonoBehaviour { }
  public class WorkshopButton : MonoBehaviour { public enum Kind { Retry, Voice, Handin, Commission } public Kind kind; public void Click(BrannWorkshop workshop) { if (workshop == null) return; if (kind == Kind.Retry) workshop.Retry(); else if (kind == Kind.Voice) workshop.CycleVoice(); else if (kind == Kind.Handin) workshop.RequestHandIn(); else if (kind == Kind.Commission) workshop.PromptCommission(); } }
}
