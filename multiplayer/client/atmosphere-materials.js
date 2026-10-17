// Atmosphere layer for every built-in lit/unlit mesh material: drifting ground mist (height fog with soft noise),
// sun in-scatter in the haze, wet surfaces in rain and settling snow. Installed once, before any material compiles.
// Presentation only. No lights, no extra draws: it rewrites three's fog chunks behind a BF_ATMOS define and feeds
// every material the same shared uniform objects, so one update per frame drives the whole world.
import * as THREE from 'three';

export const ATMOSPHERE = {
  bfTime: {value: 0},
  bfMist: {value: 0},                       // ground-mist density (0 none .. ~.12 thick fog bank)
  bfMistBase: {value: -.5},                 // world height where mist is densest
  bfMistHeight: {value: 2.6},               // e-folding height of the mist layer
  bfMistNoise: {value: 1},                  // 0 smooth layer, 1 drifting wisps
  bfWind: {value: new THREE.Vector2(.35, .12)},
  bfSunDir: {value: new THREE.Vector3(0, 1, 0)},
  bfSunScatter: {value: new THREE.Color(0, 0, 0)}, // haze glow toward the sun (already scaled)
  bfWet: {value: 0},
  bfSnow: {value: 0},
  bfSparkle: {value: 1},                    // glitter on settled snow and wet ground
  bfAerial: {value: new THREE.Vector3(0, 220, 0)}, // aerial perspective: density at y=0 (per metre), e-folding height, blue lift
};

const VERTEX_PARS = /* glsl */`
#ifdef USE_FOG
	varying float vFogDepth;
#endif
#ifdef BF_ATMOS
	varying vec3 vBfWorld;
#endif`;
const VERTEX = /* glsl */`
#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif
#ifdef BF_ATMOS
	vec4 bfWorld = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		bfWorld = batchingMatrix * bfWorld;
	#endif
	#ifdef USE_INSTANCING
		bfWorld = instanceMatrix * bfWorld;
	#endif
	vBfWorld = ( modelMatrix * bfWorld ).xyz;
#endif`;
const FRAGMENT_PARS = /* glsl */`
#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif
#ifdef BF_ATMOS
	varying vec3 vBfWorld;
	uniform float bfTime, bfMist, bfMistBase, bfMistHeight, bfMistNoise, bfWet, bfSnow, bfSparkle;
	uniform vec2 bfWind;
	uniform vec3 bfSunDir, bfSunScatter, bfAerial;
	float bfHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
	float bfNoise( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
		return mix( mix( bfHash( i ), bfHash( i + vec2( 1, 0 ) ), f.x ), mix( bfHash( i + vec2( 0, 1 ) ), bfHash( i + vec2( 1, 1 ) ), f.x ), f.y ); }
#endif`;
const FRAGMENT = /* glsl */`
#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	#ifdef BF_ATMOS
		vec3 bfRay = vBfWorld - cameraPosition; float bfLen = max( length( bfRay ), 1e-3 ); vec3 bfDir = bfRay / bfLen;
		// Exponential height mist integrated along the view ray: valleys fill, ridges stand clear.
		float bfA = exp( - ( cameraPosition.y - bfMistBase ) / bfMistHeight ), bfB = exp( - ( vBfWorld.y - bfMistBase ) / bfMistHeight );
		float bfColumn = abs( bfRay.y ) > 0.02 ? ( bfA - bfB ) * bfMistHeight / bfRay.y : 0.5 * ( bfA + bfB );
		float bfWisp = 1.0;
		if ( bfMistNoise > 0.0 ) {
			vec2 q = vBfWorld.xz * 0.055 + bfWind * bfTime * 0.05;
			bfWisp = mix( 1.0, 0.25 + 1.5 * ( bfNoise( q ) * 0.65 + bfNoise( q * 2.7 - bfWind * bfTime * 0.04 ) * 0.35 ), bfMistNoise );
		}
		float bfMistAmt = 1.0 - exp( - bfMist * bfLen * max( bfColumn, 0.0 ) * bfWisp );
		fogFactor = 1.0 - ( 1.0 - fogFactor ) * ( 1.0 - bfMistAmt );
		// Aerial perspective (big landscapes): air thins with height, so far valleys turn to blue haze while peaks
		// above it stay clear and read at their true distance.
		float bfAer = 0.0;
		if ( bfAerial.x > 0.0 ) {
			float aA = exp( - max( cameraPosition.y, -50.0 ) / bfAerial.y ), aB = exp( - max( vBfWorld.y, -50.0 ) / bfAerial.y );
			float aCol = abs( bfRay.y ) > 0.5 ? ( aA - aB ) * bfAerial.y / bfRay.y : 0.5 * ( aA + aB );
			bfAer = 1.0 - exp( - bfAerial.x * bfLen * max( aCol, 0.0 ) );
			fogFactor = 1.0 - ( 1.0 - fogFactor ) * ( 1.0 - bfAer );
		}
		float bfSun = max( dot( bfDir, normalize( bfSunDir ) ), 0.0 );
		vec3 bfFog = fogColor + bfSunScatter * ( pow( bfSun, 6.0 ) * 0.7 + pow( bfSun, 40.0 ) * 0.9 );
		bfFog = mix( bfFog, bfFog * vec3( 0.86, 0.97, 1.16 ), bfAerial.z * bfAer * ( 1.0 - bfSun * bfSun ) );
		#ifdef BF_ADDITIVE
			gl_FragColor.rgb *= 1.0 - fogFactor; // glow fades into the haze instead of adding haze colour
		#else
			gl_FragColor.rgb = mix( gl_FragColor.rgb, bfFog, fogFactor );
		#endif
	#else
		gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
	#endif
#endif`;
// Appended to emissivemap_fragment: runs in every lit material after maps and normals, before lighting.
const SURFACE = /* glsl */`
#if defined( BF_ATMOS ) && ( defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG ) || defined( TOON ) )
	if ( bfWet + bfSnow > 0.001 ) {
		vec3 bfUpV = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
		float bfUp = dot( normal, bfUpV );
		float bfNear = smoothstep( 1.2, 2.4, distance( vBfWorld, cameraPosition ) ); // keep held items clean
		float bfGlow = 1.0 - smoothstep( 0.15, 0.6, dot( totalEmissiveRadiance, vec3( 0.3, 0.55, 0.15 ) ) ); // glowing magic stays bare
		float bfN = bfNoise( vBfWorld.xz * 1.3 ) * 0.6 + bfNoise( vBfWorld.xz * 5.1 ) * 0.4;
		float bfSnowAmt = bfSnow * smoothstep( 0.25, 0.75, bfUp + ( bfN - 0.5 ) * 0.5 + ( bfSnow - 0.5 ) * 0.4 ) * bfNear * bfGlow;
		float bfWetAmt = bfWet * smoothstep( -0.2, 0.6, bfUp ) * bfNear * ( 1.0 - bfSnowAmt );
		float bfPuddle = bfWetAmt * smoothstep( 0.82, 0.98, bfUp ) * smoothstep( 0.55, 0.75, bfNoise( vBfWorld.xz * 0.35 ) );
		diffuseColor.rgb *= 1.0 - 0.38 * bfWetAmt;
		diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.86, 0.9, 0.97 ), bfSnowAmt * 0.9 );
		#ifdef STANDARD
			roughnessFactor = mix( roughnessFactor, 0.28, bfWetAmt * 0.85 );
			roughnessFactor = mix( roughnessFactor, 0.06, bfPuddle );
			roughnessFactor = mix( roughnessFactor, 0.75, bfSnowAmt );
			metalnessFactor = mix( metalnessFactor, 0.0, bfSnowAmt );
		#endif
		// Glitter: tiny cells on snow (and on puddles) flash as the view moves across them, ice-blue and warm.
		if ( bfSparkle > 0.0 && bfSnowAmt + bfPuddle > 0.05 ) {
			vec3 bfCell = floor( vBfWorld * 9.0 );
			float bfSeed = bfHash( bfCell.xz + bfCell.y * 7.13 );
			vec3 bfView = normalize( cameraPosition - vBfWorld );
			float bfFacet = fract( bfSeed * 91.7 + dot( bfView, vec3( 3.1, 1.7, 2.3 ) ) * 2.0 + bfTime * 0.05 );
			float bfGlitter = step( 0.93, bfSeed ) * smoothstep( 0.9, 1.0, bfFacet ) * smoothstep( 25.0, 4.0, distance( vBfWorld, cameraPosition ) );
			totalEmissiveRadiance += mix( vec3( 0.7, 0.88, 1.25 ), vec3( 1.25, 1.0, 0.7 ), step( 0.97, bfSeed ) ) * bfGlitter * bfSparkle * ( bfSnowAmt + bfPuddle * 0.6 ) * 2.2;
		}
	}
#endif`;

const TYPES = [THREE.MeshBasicMaterial, THREE.MeshLambertMaterial, THREE.MeshPhongMaterial, THREE.MeshStandardMaterial, THREE.MeshToonMaterial];
let installed = false;
const stats = {installed: false, compiled: 0, adopted: 0};

const additive = m => m.blending === THREE.AdditiveBlending;
function inject(shader, material) {
  const defines = '#define BF_ATMOS\n' + (material && additive(material) ? '#define BF_ADDITIVE\n' : '');
  shader.vertexShader = defines + shader.vertexShader;
  shader.fragmentShader = defines + shader.fragmentShader;
  Object.assign(shader.uniforms, ATMOSPHERE);
  stats.compiled++;
}

// Every built-in material of these types gets the atmosphere. A material that brings its own onBeforeCompile keeps it
// (it runs first) and its own cache key, so programs never get shared between different user hooks.
export function installAtmosphere() {
  if (installed) return stats;
  installed = true; stats.installed = true;
  THREE.ShaderChunk.fog_pars_vertex = VERTEX_PARS;
  THREE.ShaderChunk.fog_vertex = VERTEX;
  THREE.ShaderChunk.fog_pars_fragment = FRAGMENT_PARS;
  THREE.ShaderChunk.fog_fragment = FRAGMENT;
  THREE.ShaderChunk.emissivemap_fragment += SURFACE;
  for (const Type of TYPES) {
    Object.defineProperty(Type.prototype, 'onBeforeCompile', {
      configurable: true,
      get() { const user = this._bfUserCompile; return function (shader, renderer) { user?.call(this, shader, renderer); inject(shader, this); }; },
      set(fn) { this._bfUserCompile = typeof fn === 'function' ? fn : null; },
    });
    Object.defineProperty(Type.prototype, 'customProgramCacheKey', {
      configurable: true, writable: true,
      value() { return 'bf1:' + (additive(this) ? 'add:' : '') + (this._bfUserCompile ? this._bfUserCompile.toString() : ''); },
    });
  }
  return stats;
}

// Materials that set onBeforeCompile before the install (own data property) are moved onto the accessor.
export function adoptAtmosphere(root) {
  let n = 0;
  root.traverse(o => {
    const list = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of list) {
      if (!TYPES.some(T => m instanceof T) || !Object.hasOwn(m, 'onBeforeCompile')) continue;
      const fn = m.onBeforeCompile; delete m.onBeforeCompile; m.onBeforeCompile = fn; m.needsUpdate = true; n++;
    }
  });
  stats.adopted += n;
  return n;
}

export const atmosphereStats = () => ({...stats});

// Installed on import, so materials built by any later module (including at module scope) pick it up.
installAtmosphere();
