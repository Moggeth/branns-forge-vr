// When to show the "turn for more adventure" prompt, and when a tap may take the game full screen.
export function shouldShowTurnPrompt({touch, portrait, narrow, xr, dismissed, turnedOnce}) {
  return !!(touch && portrait && narrow && !xr && !dismissed && !turnedOnce);
}
export function shouldAutoFullscreen({armed, touch, landscape, xr, standalone, fullscreen, supported, onFullscreenButton}) {
  return !!(armed && touch && landscape && !xr && !standalone && !fullscreen && supported && !onFullscreenButton);
}
