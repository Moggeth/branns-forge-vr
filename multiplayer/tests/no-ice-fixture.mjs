// Fault injection for network acceptance only: SDP can exchange, but ICE never connects.
// This is never imported by the shipped game.
export async function disableIce(context) {
  await context.addInitScript(() => {
    window.RTCPeerConnection = class {
      connectionState = 'connecting'; remoteDescription = null;
      createDataChannel() { return {readyState:'connecting', close(){}, bufferedAmount:0}; }
      async createOffer() { return {type:'offer',sdp:'test: no viable route'}; }
      async createAnswer() { return {type:'answer',sdp:'test: no viable route'}; }
      async setLocalDescription(d) { this.localDescription=d; }
      async setRemoteDescription(d) { this.remoteDescription=d; }
      async addIceCandidate() {}
      close() {}
    };
  });
}
