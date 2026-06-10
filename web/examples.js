import { SOURCED_EXAMPLES } from './examples-sourced.js';

// Example POV-Ray SDL scenes shared by the UI page and the REPL.
// Pure data module, no DOM. Each scene has been render-verified against the
// dist/ wasm build at the editor's default Render quality (160x120, quality 9,
// antialias off, clock 0) and emits a non-trivial PNG (not an empty/black
// frame); the animated scenes additionally render a clean clock-driven
// sequence. (One build note: this build's glass.inc has no
// M_Glass* materials, so the glass example uses texture { T_Glass3 } +
// interior { I_Glass }.)
//
// Every record carries the full schema: name, title, category (one CATEGORIES
// key), tags (filter fuel, never rendered per-row), description, author,
// sourceUrl, license (SPDX), animated, frames, fps, and source. In-house scenes
// use author 'povrayer', license 'CC0-1.0', sourceUrl ''; sourced adaptations
// preserve explicit upstream attribution and a source link.
//
// Order here is the manifest order: the 11 originals first (csg-die leads as the
// default first impression), then the authored additions, then sourced
// adaptations. The browser groups and orders scenes via CATEGORIES, never by
// this array's iteration order.

// Category taxonomy. CATEGORIES order drives the group order in the browser UI;
// within a group, scenes appear in EXAMPLES array order. Labels with '&' are
// escaped to '&amp;' where injected into HTML.
export const CATEGORIES = [
  { key: 'modeling', label: 'Solid Modeling' },
  { key: 'implicit', label: 'Isosurfaces, Functions & Fractals' },
  { key: 'generative', label: 'Generative & Procedural' },
  { key: 'texturing', label: 'Textures & Normals' },
  { key: 'optics', label: 'Glass, Refraction & Caustics' },
  { key: 'lighting', label: 'Lighting & Global Illumination' },
  { key: 'environment', label: 'Skies, Atmosphere & Terrain' },
  { key: 'camera', label: 'Camera & Lens' },
  { key: 'motion', label: 'Animation' },
];

export const DIFFICULTIES = [
  { key: 'intro', label: 'Intro' },
  { key: 'intermediate', label: 'Intermediate' },
  { key: 'advanced', label: 'Advanced' },
];

export const RENDER_TIERS = [
  { key: 'instant', label: 'Instant', quality: '3' },
  { key: 'fast', label: 'Fast', quality: '5' },
  { key: 'heavy', label: 'Heavy', quality: '8' },
];

export const FEATURED_EXAMPLE_NAMES = [
  'csg-die',
  'steinmetz',
  'lathe-vase',
  'sourced-pawns',
  'sourced-bezier',
  'sweep-knot',
  'menger-sponge',
  'blobs',
  'sourced-quartic-helix',
  'julia-fractal',
  'helix',
  'materials',
  'normal-study',
  'sourced-biscuit',
  'glass',
  'sourced-wineglass',
  'sourced-magglass',
  'sourced-diffract',
  'cornell-mood',
  'soft-shadow-colonnade',
  'sourced-soft-light',
  'sunset-sea',
  'sourced-mist',
  'heightfield-dunes',
  'focal-marbles',
  'sourced-fisheye',
  'orbit-moons',
  'sourced-vector-rotation',
  'pulse-grid',
];
const FEATURED_EXAMPLE_SET = new Set(FEATURED_EXAMPLE_NAMES);

const EXAMPLE_META = {
  'csg-die': { difficulty: 'intro', renderTier: 'fast' },
  'sunset-sea': { difficulty: 'intro', renderTier: 'fast' },
  isosurface: { difficulty: 'advanced', renderTier: 'heavy' },
  blobs: { difficulty: 'intro', renderTier: 'instant' },
  glass: { difficulty: 'intermediate', renderTier: 'fast' },
  materials: { difficulty: 'intro', renderTier: 'instant' },
  helix: { difficulty: 'intermediate', renderTier: 'instant' },
  'cornell-mood': { difficulty: 'intermediate', renderTier: 'fast' },
  'focal-marbles': { difficulty: 'advanced', renderTier: 'fast' },
  'orbit-moons': { difficulty: 'intermediate', renderTier: 'instant' },
  'pulse-grid': { difficulty: 'intermediate', renderTier: 'instant' },
  steinmetz: { difficulty: 'intermediate', renderTier: 'instant' },
  'lathe-vase': { difficulty: 'intro', renderTier: 'instant' },
  'prism-lantern': { difficulty: 'intermediate', renderTier: 'fast' },
  'sweep-knot': { difficulty: 'advanced', renderTier: 'fast' },
  'parametric-shell': { difficulty: 'advanced', renderTier: 'heavy' },
  'algebraic-heart': { difficulty: 'advanced', renderTier: 'heavy' },
  'julia-fractal': { difficulty: 'advanced', renderTier: 'heavy' },
  'menger-sponge': { difficulty: 'advanced', renderTier: 'fast' },
  'agate-light': { difficulty: 'intro', renderTier: 'instant' },
  'normal-study': { difficulty: 'intro', renderTier: 'instant' },
  'photon-caustics': { difficulty: 'advanced', renderTier: 'heavy' },
  'radiosity-niche': { difficulty: 'advanced', renderTier: 'heavy' },
  'soft-shadow-colonnade': { difficulty: 'intermediate', renderTier: 'fast' },
  'god-rays': { difficulty: 'advanced', renderTier: 'heavy' },
  'heightfield-dunes': { difficulty: 'intermediate', renderTier: 'fast' },
  'focus-pull': { difficulty: 'advanced', renderTier: 'fast' },
  'pendulum-wave': { difficulty: 'intermediate', renderTier: 'instant' },
  'spin-gears': { difficulty: 'advanced', renderTier: 'fast' },
  'sourced-chess2': { difficulty: 'intro', renderTier: 'fast' },
  'sourced-wineglass': { difficulty: 'intermediate', renderTier: 'fast' },
  'sourced-infinity-box': { difficulty: 'intermediate', renderTier: 'fast' },
  'sourced-isocacti': { difficulty: 'advanced', renderTier: 'heavy' },
  'sourced-landscape': { difficulty: 'intermediate', renderTier: 'fast' },
  'sourced-woodbox': { difficulty: 'intro', renderTier: 'instant' },
  'sourced-sunsethf': { difficulty: 'intermediate', renderTier: 'fast' },
  'sourced-swirlbox': { difficulty: 'intermediate', renderTier: 'instant' },
  'sourced-mediasky': { difficulty: 'intro', renderTier: 'fast' },
  'sourced-mtmand': { difficulty: 'advanced', renderTier: 'heavy' },
  'sourced-sombrero': { difficulty: 'advanced', renderTier: 'heavy' },
  'sourced-lamppost': { difficulty: 'intro', renderTier: 'fast' },
  'sourced-optics': { difficulty: 'intermediate', renderTier: 'fast' },
  'sourced-quilt': { difficulty: 'intro', renderTier: 'instant' },
  'sourced-wallstucco': { difficulty: 'intro', renderTier: 'instant' },
  'sourced-borromean-rings': { difficulty: 'intermediate', renderTier: 'instant' },
  'sourced-figure-eight-knot': { difficulty: 'advanced', renderTier: 'fast' },
  'sourced-endless-knot': { difficulty: 'advanced', renderTier: 'fast' },
  'sourced-alexander-horned': { difficulty: 'advanced', renderTier: 'fast' },
  'sourced-diffract': { difficulty: 'intro', renderTier: 'instant' },
  'sourced-pawns': { difficulty: 'intro', renderTier: 'fast' },
  'sourced-biscuit': { difficulty: 'intro', renderTier: 'instant' },
  'sourced-bwstripe': { difficulty: 'intro', renderTier: 'instant' },
  'sourced-mist': { difficulty: 'intermediate', renderTier: 'fast' },
  'sourced-fisheye': { difficulty: 'intermediate', renderTier: 'fast' },
  'sourced-panoramic-camera': { difficulty: 'intermediate', renderTier: 'fast' },
  'sourced-magglass': { difficulty: 'intermediate', renderTier: 'fast' },
  'sourced-crystal': { difficulty: 'intermediate', renderTier: 'fast' },
  'sourced-soft-light': { difficulty: 'intro', renderTier: 'fast' },
  'sourced-laser': { difficulty: 'intermediate', renderTier: 'instant' },
  'sourced-bezier': { difficulty: 'intermediate', renderTier: 'fast' },
  'sourced-quartic-helix': { difficulty: 'advanced', renderTier: 'fast' },
  'sourced-folium': { difficulty: 'advanced', renderTier: 'fast' },
  'sourced-vector-rotation': { difficulty: 'intro', renderTier: 'instant' },
  'sourced-camera-flythrough': { difficulty: 'intermediate', renderTier: 'instant' },
  'sourced-glass-chess': { difficulty: 'intermediate', renderTier: 'fast' },
  'sourced-area-light-grid': { difficulty: 'intro', renderTier: 'fast' },
};

const addExampleMetadata = (ex) => ({
  ...ex,
  ...EXAMPLE_META[ex.name],
  featured: FEATURED_EXAMPLE_SET.has(ex.name),
  thumbnail: `example-thumbnails/${ex.name}.png`,
});

const CORE_EXAMPLES = [
  {
    name: 'csg-die',
    title: 'CSG dice (superellipsoid difference)',
    category: 'modeling',
    tags: ['csg', 'superellipsoid', 'difference', 'area-light', 'reflection'],
    description: 'Two dice modeled as a superellipsoid cube minus pip spheres',
    author: 'povrayer',
    sourceUrl: '',
    license: 'CC0-1.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Two dice, pure CSG: rounded cube (superellipsoid) minus pip spheres.
#version 3.8;
global_settings { assumed_gamma 1.0 }
#include "colors.inc"

// ---------- camera & studio lighting ----------
camera { location <4.4, 3.8, -11.5>  look_at <-0.15, 1.0, 0>  angle 32 }
light_source { <6, 9, -7> rgb <1.35, 1.28, 1.15>         // warm key light (soft shadows)
  area_light x*3, y*3, 3, 3 adaptive 1 jitter }
light_source { <-7, 4, -4> rgb <0.16, 0.22, 0.32> shadowless }  // cool fill
light_source { <0, 6, 9>  rgb 0.5 shadowless }                  // rim from behind

// ---------- backdrop & glossy floor ----------
plane { z, 14                                              // teal studio wall with a
  pigment { spherical color_map {                          // radial glow behind the dice
    [0.0 rgb <0.01, 0.04, 0.06>] [0.45 rgb <0.04, 0.14, 0.18>]
    [1.0 rgb <0.30, 0.68, 0.72>] } scale 10 translate <-5.2, 2.2, 14> }
  finish { emission 0.85 diffuse 0.25 } }                  // self-lit so gradient stays pure
plane { y, 0 pigment { rgb <0.04, 0.04, 0.05> }            // dark mirror-polish floor
  finish { diffuse 0.35 specular 0.6 roughness 0.01 reflection { 0.18, 0.55 } } }

// ---------- die construction (the CSG part) ----------
#declare PipR = 0.19;   // pip dimple radius
#declare PipD = 1.14;   // pip sphere distance from die centre (face is at 1.0)
#declare O    = 0.47;   // pip offset from face centre

#macro Face(N, Rot)     // N pips laid out on the -z face, rotated into place
  #if (mod(N,2)=1) sphere { <0,0,-PipD>, PipR rotate Rot } #end
  #if (N>=2) sphere { <-O, O,-PipD>, PipR rotate Rot }
             sphere { < O,-O,-PipD>, PipR rotate Rot } #end
  #if (N>=4) sphere { < O, O,-PipD>, PipR rotate Rot }
             sphere { <-O,-O,-PipD>, PipR rotate Rot } #end
  #if (N=6)  sphere { <-O, 0,-PipD>, PipR rotate Rot }
             sphere { < O, 0,-PipD>, PipR rotate Rot } #end
#end

#macro Die(BodyCol, PipCol)
  difference {
    superellipsoid { <0.17, 0.17>     // roundness: smaller = sharper edges
      pigment { rgb BodyCol }
      finish { specular 0.9 roughness 0.003 reflection { 0.03, 0.10 } } }
    union {                            // carve all 21 pips in one subtraction
      Face(1, <90,0,0>)   Face(6, <-90,0,0>)   // top   / bottom
      Face(2, <0,90,0>)   Face(5, <0,-90,0>)   // right / left
      Face(3, <0,0,0>)    Face(4, <0,180,0>)   // front / back
      pigment { rgb PipCol } finish { specular 0.3 roughness 0.02 } }
  }
#end

// red die sitting flat, ivory die leaning against it
object { Die(<0.78, 0.05, 0.07>, <1,1,1>)
  rotate y*-22  translate <1.0, 1.0, 0.2> }
object { Die(<0.93, 0.90, 0.84>, <0.04,0.04,0.04>)
  rotate <0, 18, 30>  translate <-1.72, 1.40, -0.1> }
`,
  },
  {
    name: 'sunset-sea',
    title: 'Sunset sea (layered sky_sphere, rippled water)',
    category: 'environment',
    tags: ['sky_sphere', 'fog', 'normal', 'reflection', 'emission'],
    description: 'Half-set sun over rippled water under a layered sunset sky',
    author: 'povrayer',
    sourceUrl: '',
    license: 'CC0-1.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Sunset over the sea -- the wallpaper scene
// Knobs: SunHeight sinks/raises the sun, WaveScale = ripple size, WaveBump = ripple strength
#version 3.8;
global_settings { assumed_gamma 1.0 }
#declare SunHeight = 0.7;   // sun center barely above the horizon (half-set)
#declare WaveScale = 0.30;
#declare WaveBump  = 1.0;

// camera: low over the water, looking into the sun
camera { location <0, 1.4, -10> look_at <0, 2.2, 10> angle 56 }

// sky: three layered pigments -- sunset gradient, cloud streaks, dusk veil
sky_sphere {
  pigment {  // base gradient: hot orange horizon up to near-night zenith
    gradient y
    color_map {
      [0.00 rgb <0.80, 0.22, 0.05>] [0.10 rgb <0.60, 0.14, 0.08>]
      [0.22 rgb <0.32, 0.08, 0.18>] [0.38 rgb <0.13, 0.06, 0.24>]
      [0.65 rgb <0.05, 0.07, 0.20>] [1.00 rgb <0.01, 0.02, 0.08>]
    }
  }
  pigment {  // cloud streaks: dark bellies, orange-lit edges, mostly clear sky
    bozo
    color_map {
      [0.00 rgbt <0.10, 0.03, 0.09, 0.20>] [0.22 rgbt <0.90, 0.25, 0.08, 0.55>]
      [0.40 rgbt <1, 1, 1, 1>] [1.00 rgbt <1, 1, 1, 1>]
    }
    scale <0.5, 0.045, 0.5> translate <0, 0.12, 0> turbulence 0.6  // squash y -> long streaks
  }
  pigment {  // dusk veil: re-darkens the sky toward the zenith
    gradient y
    color_map {
      [0.10 rgbt <0.02, 0.03, 0.10, 1.0>] [0.45 rgbt <0.02, 0.03, 0.10, 0.4>]
      [0.90 rgbt <0.01, 0.02, 0.07, 0.05>]
    }
  }
}

// the sun: glowing disc half-sunk in the sea, plus a soft halo disc behind it
sphere { <0, SunHeight, 60>, 3.0
  texture { pigment { rgb <1, 0.72, 0.35> } finish { emission 3.5 ambient 0 diffuse 0 } } no_shadow
}
disc { <0, SunHeight, 61>, -z, 16
  texture {
    pigment { spherical  // 1 at disc center fading to 0 at rim -> transparent edge
      color_map { [0 rgbt <1, 0.45, 0.1, 1>] [0.55 rgbt <1, 0.45, 0.1, 0.8>] [1 rgbt <1, 0.6, 0.2, 0.15>] }
      scale 16 translate <0, SunHeight, 61>
    }
    finish { emission 1.0 ambient 0 diffuse 0 }
  } no_shadow
}
light_source { <0, SunHeight + 3, 52> rgb <1.0, 0.55, 0.25> * 1.7 }   // warm sun light
light_source { <0, 40, -40> rgb <0.10, 0.12, 0.25> shadowless }       // cool dusk fill

// the sea: dark reflective plane; rippled normal makes the glitter path
plane { y, 0
  texture {
    pigment { rgb <0.010, 0.03, 0.07> }
    finish {
      reflection { 0.06, 0.65 falloff 3 }  // dark up close, mirror at glancing angles
      specular 0.8 roughness 0.008 diffuse 0.25
    }
    normal { bozo WaveBump scale <WaveScale, WaveScale*0.25, WaveScale*3> turbulence 0.4 }
  }
}

// distant island silhouette poking above the horizon (two cones)
union {
  cone { <-15, -0.3, 58>, 10.0, <-15, 2.8, 58>, 0 }
  cone { < -7, -0.3, 55>,  5.5, < -7, 1.5, 55>, 0 }
  texture { pigment { rgb <0.05, 0.02, 0.07> } finish { ambient 0 diffuse 0.03 } }
}

// birds: tiny V silhouettes (two angled cylinders each)
#macro Bird(Pos, Size)
  union {
    cylinder { 0, <-1, 0.4, 0>, 0.1 } cylinder { 0, <1, 0.4, 0>, 0.1 }
    scale Size translate Pos
    texture { pigment { rgb <0.03, 0.02, 0.05> } finish { ambient 0 diffuse 0 } } no_shadow
  }
#end
Bird(<6.5, 6.2, 30>, 0.40) Bird(<8.5, 5.4, 32>, 0.30) Bird(<4.8, 7.3, 34>, 0.28)

// horizon haze: thin glowing slab that fades with height (cheap atmosphere)
box { <-300, 0, 75>, <300, 4, 76>
  texture {
    pigment { gradient y color_map { [0 rgbt <1, 0.55, 0.3, 0.55>] [1 rgbt <1, 0.55, 0.3, 1>] } scale 4 }
    finish { emission 0.8 diffuse 0 }
  } no_shadow
}
`,
  },
  {
    name: 'isosurface',
    title: 'Gyroid sphere (isosurface)',
    category: 'implicit',
    tags: ['isosurface', 'function', 'minimal-surface', 'interior_texture'],
    description: 'A gyroid minimal surface rendered as a contained isosurface',
    author: 'povrayer',
    sourceUrl: '',
    license: 'CC0-1.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Gyroid -- a triply periodic minimal surface, made visible
// f(x,y,z) = sin(x)cos(y) + sin(y)cos(z) + sin(z)cos(x) = 0
#version 3.8;
global_settings { assumed_gamma 1.0 }

// ---- camera & backdrop -------------------------------------------------
camera {
  location <18, 9, -26>
  look_at  <0, -1.2, 0>
  angle 42
}
// deep space gradient backdrop
sky_sphere {
  pigment {
    gradient y
    color_map {
      [0.0 rgb <0.05, 0.03, 0.10>]
      [0.5 rgb <0.01, 0.01, 0.03>]
      [1.0 rgb <0.00, 0.00, 0.01>]
    }
  }
}

// ---- lights ------------------------------------------------------------
light_source { <25, 35, -30> rgb <1.0, 0.92, 0.8> }            // warm key
light_source { <-30, 5, -15> rgb <0.25, 0.35, 0.6> shadowless } // cool fill
light_source { <28, 18, 35> rgb <0.8, 0.2, 0.9> shadowless }    // magenta rim

// ---- glossy dark floor (catches a reflection of the ball) --------------
plane {
  y, -8.7
  pigment { rgb <0.03, 0.03, 0.05> }
  finish { reflection { 0.25, 0.45 } specular 0.3 roughness 0.01 }
}

// ---- the gyroid --------------------------------------------------------
#declare Freq = 1.4;   // bump up for more cells in the same ball
isosurface {
  function { sin(x*Freq)*cos(y*Freq) + sin(y*Freq)*cos(z*Freq) + sin(z*Freq)*cos(x*Freq) }
  threshold 0
  contained_by { sphere { 0, 8.5 } }
  accuracy 0.002
  max_gradient 2.5       // honest: analytic bound is sqrt(3)*Freq ~= 2.43
  open

  // two-tone trick: outside faces copper, inside faces teal
  texture {
    pigment { rgb <0.85, 0.45, 0.18> }
    finish { specular 0.6 roughness 0.02 metallic ambient 0.05 }
  }
  interior_texture {
    pigment { rgb <0.05, 0.75, 0.7> }
    finish { specular 0.4 roughness 0.05 ambient 0.08 }
  }
}
`,
  },
  {
    name: 'blobs',
    title: 'Liquid chrome (blob / metaballs)',
    category: 'implicit',
    tags: ['blob', 'metaballs', 'reflection', 'metallic'],
    description: 'A liquid-chrome metaball column with mirror reflections',
    author: 'povrayer',
    sourceUrl: '',
    license: 'CC0-1.0',
    animated: false,
    frames: null,
    fps: null,
    source: `#version 3.8;
global_settings { assumed_gamma 1.0 }
// Liquid-metal blob sculpture -- metaballs, not spheres!
// Tweak sphere positions/strengths in the blob {}, or the two
// environment colors below, and the whole mood changes.
#include "colors.inc"

camera {
  location <0, 1.0, -8.5>   // low-angle hero shot; raise y for a flatter view
  look_at  <0, 2.5, 0>
  angle 45                  // smaller = zoom in
}

// dramatic rim lighting: cold left, hot right, faint front fill
light_source { <-9, 7, 6>   rgb <0.25, 0.5, 1.0>*3.0 }
light_source { < 9, 6, 5>   rgb <1.0, 0.40, 0.10>*3.2 }
light_source { < 0, 9, -10> rgb 0.25 }

// giant gradient shell the chrome reflects -- no_image hides it from the
// camera, so we get colored reflections against a dark backdrop
sphere { 0, 60 hollow
  pigment {
    gradient x
    color_map { [0.00 rgb <0.05, 0.25, 0.9>]  // deep blue side
                [0.45 rgb <0, 0, 0.02>] [0.55 rgb <0, 0, 0.02>]
                [1.00 rgb <1.0, 0.35, 0.05>] } // molten orange side
    scale 120 translate -60*x
    rotate 30*y                       // wraps color toward the camera side
  }
  finish { emission 0.7 diffuse 0 }
  no_shadow no_image
}

// what the camera actually sees behind the blob: near-black, faint glow
sky_sphere {
  pigment { gradient y
    color_map { [0 rgb <0.007,0.007,0.016>] [0.35 rgb <0.003,0.003,0.008>] [1 rgb 0] }
  }
}

// the blob: a rising lava-lamp column with breakaway drops.
// Each entry: <center>, radius, strength. Lower threshold = gooier merges.
blob {
  threshold 0.55
  sphere { < 0.00, 0.45, 0.0>, 1.50, 2.0 }  // base puddle
  sphere { < 0.30, 1.40, 0.0>, 1.00, 1.2 }
  sphere { <-0.25, 2.20, 0.1>, 0.85, 1.1 }
  sphere { < 0.20, 3.00,-0.1>, 0.70, 1.0 }
  sphere { <-0.15, 3.70, 0.0>, 0.55, 0.9 }
  sphere { < 0.10, 4.25, 0.0>, 0.38, 0.8 }  // thinning neck
  sphere { <-0.05, 4.70, 0.0>, 0.24, 0.7 }  // breakaway droplet
  sphere { < 1.55, 0.25,-0.5>, 0.40, 1.0 }  // floor splash, right
  sphere { <-1.35, 0.20, 0.4>, 0.32, 1.0 }  // floor splash, left
  // mirror chrome: near-total reflection, razor highlight
  pigment { rgb <0.92, 0.95, 1.0> }
  finish { ambient 0 diffuse 0.05 metallic specular 1 roughness 0.002
           reflection { 0.85, 1.0 metallic } }
}

// floor: mirror pool near the blob, fading to void so no horizon line glares
plane { y, 0
  texture {
    cylindrical                       // 1 at origin -> 0 at scale distance
    texture_map {
      [0.00 pigment { rgb 0 } finish { diffuse 0.02 } ]
      [0.40 pigment { rgb <0.008,0.008,0.012> }
            finish { reflection { 0.18, 0.5 falloff 3 }
                     diffuse 0.2 specular 0.5 roughness 0.006 } ]
    }
    scale 16
  }
}
`,
  },
  {
    name: 'glass',
    title: 'Glass lens at dusk (glass.inc, refraction)',
    category: 'optics',
    tags: ['glass', 'refraction', 'ior', 'dispersion', 'caustics', 'glass.inc'],
    description: 'Refracting glass lens, cylinder, and slab over a checker floor',
    author: 'povrayer',
    sourceUrl: '',
    license: 'CC0-1.0',
    animated: false,
    frames: null,
    fps: null,
    source: `#version 3.8;
global_settings { assumed_gamma 1.0 max_trace_level 8 }

#include "colors.inc"
#include "glass.inc"   // glass textures (T_Glass*) + interiors (I_Glass) with real ior

// ---------- camera & lights ----------
camera {
  location <-1.0, 2.0, -6.8>   // move around to change the view
  look_at  <0, 1.5, 0.4>
  angle 48
}
light_source { <6, 10, -8> color rgb 1.3 }            // key light
light_source { <-8, 5, -4> color rgb 0.30 shadowless } // soft fill

// ---------- bold checkered floor (the thing being refracted) ----------
plane { y, 0
  pigment { checker rgb <1.0, 0.50, 0.04>, rgb <0.04, 0.05, 0.13> scale 1 }
  finish { ambient 0.18 diffuse 0.95 reflection 0.07 }
}

// fog fades the far checks into the night sky = clean horizon
fog { fog_type 2 distance 45 color rgb <0.14, 0.05, 0.22> fog_offset 0 fog_alt 1.2 }

// ---------- gradient night sky ----------
sky_sphere {
  pigment { gradient y
    color_map { [0.00 rgb <0.45,0.15,0.50>] [0.22 rgb <0.02,0.02,0.08>] }
  }
}

// ---------- glass objects ----------
// 1) the lens: big clear sphere flips & magnifies the checks behind it
sphere { <0.1, 1.5, 0.4>, 1.5
  texture { T_Glass3 }           // clear glass texture (glass.inc)
  // ior 1.5 = real glass; slight dispersion = rainbow fringes; caustics = fake hot spots in shadows
  interior { I_Glass ior 1.5 dispersion 1.03 dispersion_samples 6 caustics 0.9 }
}

// 2) tall green glass cylinder, left
cylinder { <-2.9, 0.001, 2.8>, <-2.9, 3.2, 2.8>, 0.8
  texture { T_Glass3 pigment { rgbf <0.40, 1.0, 0.55, 0.93> } }
  interior { I_Glass ior 1.5 caustics 0.8 }
}

// 3) amber glass slab, right, angled to throw skewed refraction
box { <-0.75, 0, -0.28>, <0.75, 2.55, 0.28>
  rotate y*-28
  translate <2.8, 0, 2.3>
  texture { T_Glass3 pigment { rgbf <1.0, 0.72, 0.30, 0.92> } }
  interior { I_Glass ior 1.5 caustics 0.8 }
}
`,
  },
  {
    name: 'materials',
    title: 'Stdlib material gallery (stones, woods, metals, golds)',
    category: 'texturing',
    tags: ['textures', 'stones.inc', 'woods.inc', 'metals.inc', 'golds.inc', 'array'],
    description: 'Seven spheres of stdlib stones, woods, metals, and golds',
    author: 'povrayer',
    sourceUrl: '',
    license: 'CC0-1.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// "Look what ships in the box" -- POV-Ray stdlib material gallery.
// Seven spheres in a shallow arc: stones, woods, metals, golds straight
// from the standard include files. Tweak the Mats array to swap looks.
#version 3.8;
global_settings { assumed_gamma 1.0 }

#include "colors.inc"
#include "textures.inc"
#include "stones.inc"   // T_Stone1..44 marble & granite
#include "woods.inc"    // T_Wood1..35
#include "metals.inc"   // chrome, copper, silver, brass
#include "golds.inc"    // T_Gold_*

camera { location <0, 2.6, -12.2> look_at <0, 1.25, 0.6> angle 48 }

// --- lighting: warm key, cool fill, rim from behind ---
light_source { <6, 15, -11> rgb <1.15, 1.05, 0.9> }
light_source { <-10, 6, -6> rgb <0.22, 0.27, 0.38> shadowless }
light_source { <0, 6, 12>   rgb <0.35, 0.40, 0.50> shadowless }

// overhead "softbox" panel -- only visible in the metal reflections
box { <-10, 8, -7>, <10, 8.2, -1>
  pigment { rgb 1 } finish { emission 0.6 diffuse 0 } no_shadow
}

// --- dark polished studio floor ---
plane { y, 0
  pigment { rgb <0.025, 0.025, 0.035> }
  finish { diffuse 0.4 specular 0.3 roughness 0.01
           reflection { 0.1, 0.55 falloff 2 } }
}

// subtle dark-blue gradient backdrop
sky_sphere {
  pigment { gradient y
    color_map { [0.0 rgb <0.02, 0.02, 0.04>] [0.5 rgb <0.07, 0.06, 0.15>] }
  }
}

// --- the gallery: swap any entry, re-render, enjoy ---
#declare Mats = array[7] {
  texture { T_Stone21 scale 1.6 },             // red marble, black veins
  texture { T_Wood28  scale 1.4 rotate x*85 }, // golden burl wood
  texture { T_Chrome_5E },                     // mirror chrome
  texture { T_Gold_1C },                       // hero: rich polished gold
  texture { T_Stone18 scale 1.6 },             // teal serpentine marble
  texture { T_Wood6   scale 1.4 rotate x*85 }, // dark mahogany rings
  texture { T_Copper_2D }                      // deep warm copper
}

// shallow arc curving away from camera, hero in the middle
#for (I, 0, 6)
  #local X = (I - 3) * 2.15;
  sphere { 0, 1
    texture { Mats[I] }
    translate <X, 1, 0.13 * X * X>
  }
#end
`,
  },
  {
    name: 'helix',
    title: 'DNA double helix (#while loop)',
    category: 'generative',
    tags: ['while-loop', 'macro', 'fog', 'reflection'],
    description: 'A DNA double helix generated with a single #while loop',
    author: 'povrayer',
    sourceUrl: '',
    license: 'CC0-1.0',
    animated: false,
    frames: null,
    fps: null,
    source: `#version 3.8;
global_settings { assumed_gamma 1.0 }

// DNA double helix built entirely with one #while loop.
// Tweak Turns / StepsPerTurn / Radius / Rise and re-render to play.
#declare Turns        = 3;      // how many full twists
#declare StepsPerTurn = 18;     // beads per twist (smoothness)
#declare Radius       = 1.0;    // helix radius
#declare Rise         = 2.3;    // vertical height per twist
#declare BeadR        = 0.19;   // backbone sphere size
#declare RungEvery    = 3;      // a base-pair rung every N steps

camera { location <5.5, 5.0, -14.5> look_at <0.6, 3.4, 0> angle 40 }

// cool key light (area light = soft shadows) + blue rim fill from behind-left
light_source { <12, 16, -14> rgb <1.0, 1.05, 1.15>
  area_light <6, 0, 0>, <0, 0, 6>, 3, 3 adaptive 1 jitter
}
light_source { <-14, 8, 6> rgb <0.15, 0.25, 0.55> shadowless }

// deep night-blue gradient backdrop + distant fog for a subtle depth fade
sky_sphere { pigment { gradient y color_map {
  [0.0 rgb <0.01, 0.01, 0.04>] [0.5 rgb <0.03, 0.06, 0.16>] [1.0 rgb <0.08, 0.16, 0.38>]
} } }
fog { distance 80 color rgb <0.02, 0.04, 0.10> }

// soft blue glow hanging behind the helix (emissive backdrop plane)
plane { z, 30
  pigment { spherical
    color_map { [0 rgb <0.005, 0.01, 0.035>] [1 rgb <0.10, 0.20, 0.48>] }
    scale 13 translate <-2, 4.5, 30>
  }
  finish { emission 1 diffuse 0 ambient 0 } no_shadow
}

// glossy plastic finish shared by everything
#declare Glossy = finish { ambient 0.04 diffuse 0.8 specular 1.0 roughness 0.008 reflection 0.15 }
#declare StrandA = texture { pigment { rgb <0.0, 0.60, 1.0> } finish { Glossy } }   // electric cyan
#declare StrandB = texture { pigment { rgb <0.55, 0.10, 1.0> } finish { Glossy } }  // violet
// alternating base-pair colors, faint self-glow so they read clearly
#declare RungGlow = finish { Glossy emission 0.25 }
#declare Rung1 = texture { pigment { rgb <1.0, 0.75, 0.10> } finish { RungGlow } }  // gold
#declare Rung2 = texture { pigment { rgb <1.0, 0.18, 0.45> } finish { RungGlow } }  // hot pink

union {
  #declare I = 0;
  #while (I <= Turns * StepsPerTurn)
    #declare Ang = I * 360 / StepsPerTurn;       // twist angle
    #declare H   = I * Rise / StepsPerTurn;      // height along axis
    #declare P1  = <Radius*cos(radians(Ang)),  H, Radius*sin(radians(Ang))>;
    #declare P2  = <-Radius*cos(radians(Ang)), H, -Radius*sin(radians(Ang))>;
    sphere { P1, BeadR texture { StrandA } }
    sphere { P2, BeadR texture { StrandB } }
    #if (mod(I, RungEvery) = 0)                  // base-pair rung
      cylinder { P1, P2, 0.08
        #if (mod(I / RungEvery, 2) = 0) texture { Rung1 } #else texture { Rung2 } #end
      }
    #end
    #declare I = I + 1;
  #end
  rotate z*-10 rotate y*15   // slight lean for a more dynamic pose
}

// mirror-dark floor grounds the scene with reflections
plane { y, -0.3
  pigment { rgb <0.02, 0.03, 0.06> }
  finish { reflection 0.45 diffuse 0.3 specular 0.3 roughness 0.02 }
}
`,
  },
  {
    name: 'cornell-mood',
    title: 'Cornell mood (radiosity, area light)',
    category: 'lighting',
    tags: ['radiosity', 'area-light', 'color-bleed', 'reflection'],
    description: 'A Cornell-style room lit by one radiosity area-light softbox',
    author: 'povrayer',
    sourceUrl: '',
    license: 'CC0-1.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// cornell-mood -- one ceiling softbox, three shapes, lighting is everything.
// Tweak ideas: light brightness (*1.6), fade_distance (smaller = moodier),
// area_light panel size, radiosity brightness, or the wall colors.
#version 3.8;
global_settings {
  assumed_gamma 1.0
  // one-bounce radiosity = the color bleed on the white block and ceiling.
  // Delete this block to see what direct light alone looks like (darker, harsher).
  radiosity { count 250 recursion_limit 1 error_bound 0.25 nearest_count 12
              minimum_reuse 0.01 pretrace_start 0.08 pretrace_end 0.005
              gray_threshold 0.0 brightness 0.7 }
}

#declare RoomW = 2.3;   // half-width: squeeze it and the colored walls close in
#declare RoomH = 3.4;   // ceiling height

camera {
  location <0, 1.55, -6.4>      // outside the missing front wall
  look_at  <0, 1.75, 0>         // aimed slightly up so the glowing panel shows
  angle 44
}

// ---- the softbox: a single big area light hugging the ceiling ----------
light_source {
  <0, RoomH - 0.06, 0.4>
  rgb <1.0, 0.94, 0.84> * 1.6   // warm studio white
  area_light x*2.2, z*2.2, 9, 9 // big panel -> the soft penumbras everywhere
  adaptive 1 jitter circular orient
  fade_distance 4.5 fade_power 2  // falloff = moody corners
}
// visible glowing panel so the light reads as an object in the mirror ball
box { <-1.1, RoomH-0.03, -0.7>, <1.1, RoomH, 1.5>
  pigment { rgb 1 } finish { emission 1.5 diffuse 0 } no_shadow }

// ---- the room (Cornell style: tinted side walls bleed onto everything) --
#declare Matte = finish { diffuse 0.85 ambient 0 }
plane { y, 0      pigment { rgb 0.62 } finish { Matte } }               // floor
plane { y, RoomH  pigment { rgb 0.85 } finish { Matte } }               // ceiling
plane { z, 2.5    pigment { rgb 0.78 } finish { Matte } }               // back
plane { x, -RoomW pigment { rgb <0.72, 0.10, 0.09> } finish { Matte } } // red
plane { x,  RoomW pigment { rgb <0.09, 0.42, 0.13> } finish { Matte } } // green
plane { z, -8     pigment { rgb 0.05 } finish { Matte } }               // behind cam

// ---- the cast ------------------------------------------------------------
// tall matte block, rotated like the classic Cornell box
box { <-0.55, 0, -0.55>, <0.55, 2.2, 0.55>
  pigment { rgb 0.93 } finish { Matte }
  rotate y*18 translate <-1.1, 0, 1.3> }

// mirror sphere: collects the red wall, green wall and the glowing panel
sphere { <0.95, 0.78, 0.55>, 0.78
  pigment { rgb 0.05 }
  finish { reflection { 0.9 metallic } specular 1 roughness 0.001 diffuse 0.1 } }

// small amber sphere up front, sitting in the softest part of the shadow
sphere { <-0.35, 0.42, -1.4>, 0.42
  pigment { rgb <0.88, 0.60, 0.25> } finish { Matte } }
`,
  },
  {
    name: 'focal-marbles',
    title: 'Focal marbles (depth-of-field bokeh)',
    category: 'camera',
    tags: ['depth-of-field', 'aperture', 'focal_point', 'bokeh', 'fog'],
    description: 'Glossy marbles with depth-of-field bokeh from fairy lights',
    author: 'povrayer',
    sourceUrl: '',
    license: 'CC0-1.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Focal Marbles -- depth-of-field beauty shot.
// Glossy marbles on a wood table at dusk; the camera focuses on the red hero
// marble while near/far marbles and fairy lights behind melt into bokeh.
#version 3.8;
global_settings { assumed_gamma 1.0 }
#include "colors.inc"
#include "woods.inc"

// Camera: aperture = blur strength, focal_point = what stays sharp.
// blur_samples/variance trade render time for smooth bokeh.
camera {
  location <-1.5, 0.9, -4.0>  look_at <0.3, 0.35, 0.5>  angle 35
  aperture 0.6  focal_point <0.3, 0.4, 0.3>
  blur_samples 40  confidence 0.9  variance 1/180
}

light_source { <-6, 8, -6> rgb <1.15, 1.0, 0.85> }            // warm key
light_source { <6, 3, 2>   rgb <0.15, 0.2, 0.35> shadowless } // cool fill

// Dusk sky: amber glow at the horizon fading to night blue.
sky_sphere { pigment { gradient y color_map {
  [0.00 rgb <0.30,0.14,0.03>] [0.15 rgb <0.06,0.04,0.08>] [0.50 rgb <0.01,0.015,0.05>] } } }

// Night fog fades the distant table to dark so the bokeh lights pop.
fog { distance 18 color rgb <0.02, 0.02, 0.045> }

// Wood tabletop with a light gloss coat.
plane { y, 0 texture { T_Wood6 scale 1.2 rotate y*88
  finish { reflection 0.16 specular 0.5 roughness 0.012 } } }

// Shared glassy-glossy marble finish (fresnel = stronger edge reflections).
#declare GlossFinish = finish { ambient 0.03 diffuse 0.6 specular 1.0
  roughness 0.0008 reflection { 0.05, 0.5 fresnel } conserve_energy }

#macro Marble(Pos, R, Pig, Bumpy)
  sphere { Pos, R
    texture { pigment { Pig } finish { GlossFinish }
      #if (Bumpy) normal { bumps 0.2 scale 0.04 } #end }
    interior { ior 1.5 } }
#end

// Marbles: (position, radius, pigment, bumpy surface?)
Marble(<0.3, 0.4, 0.3>, 0.4, pigment { rgb <0.85,0.12,0.08> }, no)  // hero, in focus
Marble(<-0.55, 0.3, 1.0>, 0.3, pigment { marble turbulence 1 color_map {
  [0.0 rgb <0.05,0.2,0.75>] [0.5 rgb <0.85,0.92,1>] [1.0 rgb <0.05,0.2,0.75>] } scale 0.4 }, no)
Marble(<1.15, 0.24, 0.6>, 0.24, pigment { agate agate_turb 1 color_map {
  [0.0 rgb <1,0.8,0.3>] [1.0 rgb <0.6,0.2,0.02>] } scale 0.3 }, no)
Marble(<-1.15, 0.33, -1.9>, 0.33, pigment { rgb <0.95,0.65,0.05> }, yes) // blurred foreground
Marble(<0.8, 0.24, -1.4>, 0.24, pigment { rgb <0.1,0.6,0.25> }, no)
Marble(<1.6, 0.34, 2.2>, 0.34, pigment { rgb <0.5,0.1,0.7> }, yes)       // blurred background
Marble(<-0.15, 0.3, 3.0>, 0.3, pigment { rgb <0.08,0.45,0.85> }, no)

// Fairy lights: glowing spheres far behind become big soft bokeh discs.
// Keep the radius generous or the blur sampler turns them into dot patterns;
// emission is boosted so they punch through the fog.
#declare Glow = finish { emission 3.0 diffuse 0 ambient 0 }
#macro Bokeh(Pos, C) sphere { Pos, 0.24 pigment { rgb C } finish { Glow } no_shadow } #end
Bokeh(<-2.2, 1.6, 9>,  <1.0, 0.7, 0.3>)   Bokeh(<-0.8, 2.3, 11>, <1.0, 0.45, 0.2>)
Bokeh(<0.9, 1.2, 10>,  <0.4, 0.8, 1.0>)   Bokeh(<2.4, 2.0, 9>,   <1.0, 0.85, 0.4>)
Bokeh(<3.8, 1.0, 12>,  <1.0, 0.5, 0.6>)   Bokeh(<-3.6, 0.9, 10>, <0.5, 1.0, 0.7>)
Bokeh(<1.9, 2.4, 12>,  <1.0, 0.7, 0.3>)   Bokeh(<-1.6, 0.5, 7>,  <1.0, 0.6, 0.25>)
Bokeh(<3.2, 1.6, 10>,  <1.0, 0.75, 0.35>) Bokeh(<2.6, 0.8, 8>,   <0.45, 0.85, 1.0>)
`,
  },
  {
    name: 'orbit-moons',
    title: 'Orbit (two moons, clock-driven)',
    category: 'motion',
    tags: ['clock', 'rotate', 'seamless-loop', 'starfield'],
    description: 'Two moons orbiting a banded planet, driven by the clock',
    author: 'povrayer',
    sourceUrl: '',
    license: 'CC0-1.0',
    animated: true,
    frames: 24,
    fps: 24,
    source: `// Orbit -- two moons circling a banded planet.
// clock (0..1) drives one full orbit via rotate y*(clock*360).
// Animate it (4+ frames) to watch them swing around; at clock=0 it's a
// clean still. Tweak the orbit radii, tilts, or the planet bands.
#version 3.8;
global_settings { assumed_gamma 1.0 }

#declare RadA  = 4.2;   // moon orbit radii
#declare RadB  = 6.0;
#declare TiltA = 18;    // orbital-plane leans (degrees)
#declare TiltB = -34;

camera { location <0, 5.5, -13> look_at <0, 0.2, 0> angle 46 }

// warm sun key, cool space fill
light_source { <-16, 10, -11> rgb <1.28, 1.14, 0.96> }
light_source { <14, 4, 8> rgb <0.12, 0.18, 0.32> shadowless }

// starfield: dark sky speckled with a sparse granite of bright points
sky_sphere {
  pigment { granite color_map {
    [0.00 rgb <0.01, 0.01, 0.03>] [0.86 rgb <0.01, 0.01, 0.03>]
    [0.92 rgb <0.35, 0.40, 0.55>] [1.00 rgb <1, 1, 1>]
  } scale 0.5 }
}

// the planet: a turbulent blue-banded marble world
sphere { 0, 2.4
  texture {
    pigment { gradient y turbulence 0.35 color_map {
      [0.0 rgb <0.03, 0.18, 0.42>] [0.40 rgb <0.06, 0.45, 0.62>]
      [0.55 rgb <0.85, 0.90, 0.95>] [0.70 rgb <0.06, 0.45, 0.62>]
      [1.0 rgb <0.03, 0.18, 0.42>]
    } scale <1, 0.5, 1> }
    finish { ambient 0.04 diffuse 0.9 specular 0.25 roughness 0.05 }
  }
}
// thin emissive shell = soft atmosphere rim against the stars
sphere { 0, 2.62 hollow
  pigment { rgbt <0.30, 0.60, 1.0, 0.78> }
  finish { emission 0.55 diffuse 0 } no_shadow
}

// a moon parked on +x, swung around y by clock, then the plane is tilted.
// Phase spreads the two moons apart; Spin sets orbit direction.
#macro Moon(Rad, Tilt, Phase, Spin, Col)
  sphere { <Rad, 0, 0>, 0.55
    texture {
      pigment { rgb Col }
      normal { bumps 0.6 scale 0.18 }
      finish { ambient 0.03 diffuse 0.85 specular 0.15 roughness 0.06 }
    }
    rotate y*(clock*360*Spin + Phase)   // <-- the animated swing
    rotate z*Tilt                       // lean the orbital plane
  }
#end
Moon(RadA, TiltA,  40,  1, <0.80, 0.76, 0.70>)  // pale moon, prograde
Moon(RadB, TiltB, 210, -1, <0.72, 0.46, 0.30>)  // rust moon, retrograde
`,
  },
  {
    name: 'pulse-grid',
    title: 'Pulse grid (traveling wave, clock-driven)',
    category: 'motion',
    tags: ['clock', 'traveling-wave', 'emission', 'for-loop'],
    description: 'A sphere lattice pulsing in a clock-driven traveling wave',
    author: 'povrayer',
    sourceUrl: '',
    license: 'CC0-1.0',
    animated: true,
    frames: 24,
    fps: 24,
    source: `// Pulse grid -- a lattice of spheres breathing in a traveling ring wave.
// Each sphere's radius + glow follow sin(clock*2*pi - dist), so a pulse
// radiates from the center as clock sweeps 0..1. Animate for the full loop;
// a still just freezes one phase. Tweak N, Spacing, or the two glow colors.
#version 3.8;
global_settings { assumed_gamma 1.0 }

#declare N       = 5;      // grid is (2N+1) x (2N+1) spheres
#declare Spacing = 1.15;
#declare TwoPi   = 2 * pi;

camera { location <0, 13, -15> look_at <0, -0.4, 0> angle 44 }

light_source { <-12, 18, -10> rgb <0.50, 0.55, 0.70> }
light_source { <10, 6, -6> rgb <0.20, 0.15, 0.30> shadowless }

// near-black void with the faintest cool gradient
sky_sphere { pigment { gradient y color_map {
  [0 rgb <0.004, 0.004, 0.010>] [1 rgb <0.02, 0.03, 0.06>]
} } }

// dark mirror floor catches the glow
plane { y, -1.2
  pigment { rgb <0.01, 0.01, 0.02> }
  finish { reflection { 0.30, 0.6 } specular 0.3 roughness 0.02 diffuse 0.1 }
}

// glow color ramp: cool troughs -> hot crests
#declare ColdCol = <0.05, 0.35, 0.90>;
#declare HotCol  = <1.00, 0.55, 0.10>;

#for (Ix, -N, N)
  #for (Iz, -N, N)
    #local Dist = sqrt(Ix * Ix + Iz * Iz);
    // traveling wave, normalized 0..1; phase lags with distance from center
    #local Wave = (1 + sin(clock * TwoPi - Dist * 0.9)) / 2;
    #local Rad  = 0.18 + 0.32 * Wave;             // breathe the radius
    sphere { <Ix * Spacing, 0, Iz * Spacing>, Rad
      pigment { rgb (ColdCol + (HotCol - ColdCol) * Wave) }
      finish { ambient 0.05 diffuse 0.3
               emission (0.15 + 2.2 * Wave * Wave) }  // crests glow hot
    }
  #end
#end
`,
  },
  {
    name: 'steinmetz',
    title: 'Steinmetz solid (CSG intersection)',
    category: 'modeling',
    tags: ['csg', 'intersection', 'cylinder', 'steinmetz', 'polished-metal'],
    description: 'A tricylinder Steinmetz solid from three intersecting cylinders on a turntable',
    author: 'povrayer',
    sourceUrl: '',
    license: 'CC0-1.0',
    animated: false,
    frames: null,
    fps: null,
    source: `#version 3.8;
// Steinmetz solid: the intersection of three perpendicular cylinders (the
// tricylinder). Pure CSG -- intersection {}, the complement of csg-die's
// difference -- in polished steel on a turntable plinth.
global_settings { assumed_gamma 1.0 }
#include "colors.inc"

// ---------- camera & studio lighting ----------
camera { location <5.6, 4.6, -8.4>  look_at <0, 1.65, 0>  angle 32 }
light_source { <7, 11, -8> rgb <1.55, 1.48, 1.34>        // warm key (soft shadows)
  area_light x*3, y*3, 3, 3 adaptive 1 jitter }
light_source { <-8, 5, -5> rgb <0.30, 0.40, 0.55> shadowless }  // cool fill
light_source { <-3, 8, -9> rgb <1.1, 1.05, 0.95> shadowless }   // hot key highlight
light_source { <0, 7, 8>   rgb 0.55 shadowless }                // rim from behind

// ---------- backdrop & glossy floor ----------
plane { z, 16                                            // cool studio wall with a
  pigment { spherical color_map {                        // soft glow behind the solid
    [0.0 rgb <0.03, 0.05, 0.08>] [0.5 rgb <0.10, 0.18, 0.24>]
    [1.0 rgb <0.30, 0.52, 0.62>] } scale 13 translate <-4.5, 3.0, 16> }
  finish { emission 0.95 diffuse 0.2 } }                 // self-lit so gradient stays pure
plane { y, 0 pigment { rgb <0.03, 0.03, 0.04> }          // dark mirror-polish floor
  finish { diffuse 0.3 specular 0.5 roughness 0.012 reflection { 0.14, 0.5 } } }

// ---------- turntable plinth ----------
cylinder { <0,0,0>, <0,0.34,0>, 2.0
  pigment { rgb <0.09, 0.10, 0.12> }
  finish { ambient 0 diffuse 0.32 specular 0.4 roughness 0.02 reflection { 0.06, 0.18 } } }
cylinder { <0,0.34,0>, <0,0.5,0>, 1.65
  pigment { rgb <0.14, 0.15, 0.18> }
  finish { ambient 0 diffuse 0.38 specular 0.5 roughness 0.015 reflection { 0.05, 0.15 } } }

// ---------- the Steinmetz solid (the CSG intersection) ----------
// Three cylinders of equal radius R on the X, Y and Z axes; each runs well
// past the +-R region so its caps never clip the lens-shaped intersection.
#declare R = 1.28;
intersection {
  cylinder { -2.4*x, 2.4*x, R }   // axis along X
  cylinder { -2.4*y, 2.4*y, R }   // axis along Y
  cylinder { -2.4*z, 2.4*z, R }   // axis along Z
  pigment { rgb <0.66, 0.68, 0.74> }
  finish { ambient 0 diffuse 0.32 metallic brilliance 2.6
           specular 1 roughness 0.0055
           reflection { 0.22, 0.55 metallic } }
  rotate y*16                     // turn an edge toward the key for a bright facet
  translate <0, 1.78, 0>
}
`,
  },
  {
    name: 'lathe-vase',
    title: 'Turned vase (lathe / surface of revolution)',
    category: 'modeling',
    tags: ['lathe', 'surface-of-revolution', 'spline', 'glaze', 'studio-light'],
    description: 'A glazed ceramic vase turned from a cubic_spline lathe profile',
    author: 'povrayer',
    sourceUrl: '',
    license: 'CC0-1.0',
    animated: false,
    frames: null,
    fps: null,
    source: `#version 3.8;
// Turned vase: a surface of revolution. A single cubic_spline profile is
// swept around the Y axis by lathe {}, then dressed in a thin reflective
// celadon glaze and lit studio-style.
global_settings { assumed_gamma 1.0 }
#include "colors.inc"

// ---------- camera & three-point studio lighting ----------
camera { location <3.1, 2.55, -7.6>  look_at <0, 1.75, 0>  angle 33 }
light_source { <-6, 8, -6> rgb <1.28, 1.24, 1.18>       // warm key, soft softbox
  area_light x*4, z*4, 4, 4 adaptive 1 jitter }
light_source { <7, 4, -3> rgb <0.34, 0.40, 0.52> shadowless }   // cool fill
light_source { <2, 6, 7>  rgb <0.6, 0.58, 0.55> shadowless }    // back rim for the glaze

// ---------- seamless studio sweep & floor ----------
plane { z, 12                                            // pale grey cyclorama, self-lit
  pigment { gradient y color_map {
    [0.0 rgb <0.06, 0.07, 0.09>] [0.55 rgb <0.16, 0.17, 0.20>]
    [1.0 rgb <0.30, 0.32, 0.36>] } scale 9 translate <0, -1, 12> }
  finish { emission 0.85 diffuse 0.2 } }
plane { y, 0 pigment { rgb <0.10, 0.10, 0.12> }         // soft reflective sweep floor
  finish { ambient 0 diffuse 0.4 specular 0.3 roughness 0.04 reflection { 0.08, 0.3 } } }

// ---------- the lathe (the surface of revolution) ----------
// Profile points are <radius, height>. cubic_spline needs a control point at
// each end (idx 0 and the last), so the visible curve runs from <0,0> at the
// base to <0,3.10> at the dished mouth -- both on the axis, closing the solid.
lathe {
  cubic_spline
  12,
  <0.00, -0.30>,   // start control (sets base tangent)
  <0.00,  0.00>,   // base centre, on axis
  <1.05,  0.02>,   // base rim
  <1.18,  0.55>,
  <1.34,  1.25>,   // belly (widest)
  <1.12,  2.00>,
  <0.66,  2.65>,   // neck (narrowest)
  <0.86,  3.15>,   // shoulder flare
  <0.80,  3.45>,   // lip, outer
  <0.55,  3.42>,   // lip, inner -> dishes inward to read as a mouth
  <0.00,  3.10>,   // mouth floor, on axis
  <0.00,  2.80>    // end control (sets mouth tangent)
  // thin celadon glaze: ceramic body, crisp highlight, a hint of reflection
  pigment { rgb <0.16, 0.46, 0.43> }
  finish { ambient 0 diffuse 0.5 brilliance 1.4
           specular 0.85 roughness 0.006
           reflection { 0.05, 0.16 fresnel } }
  interior { ior 1.5 }
}
`,
  },
  {
    name: 'prism-lantern',
    title: 'Star lantern (prism extrusion)',
    category: 'modeling',
    tags: ['prism', 'extrusion', 'emission', 'star-polygon'],
    description: 'A star paper lantern extruded by a linear prism sweep, faintly lit within',
    author: 'povrayer',
    sourceUrl: '',
    license: 'CC0-1.0',
    animated: false,
    frames: null,
    fps: null,
    source: `#version 3.8;
// Star lantern: a five-point star polygon swept vertically by a linear prism.
// A faint emissive inner shell lights the translucent paper so the extruded
// star silhouette reads against a dark set.
global_settings { assumed_gamma 1.0 }
#include "colors.inc"

// ---------- camera & a dark, low-key set ----------
camera { location <4.4, 4.7, -6.2>  look_at <0, 1.25, 0>  angle 40 }
light_source { <2.2, 1.6, 0> rgb <1.0, 0.72, 0.4> * 1.6   // warm bulb inside the lantern
  fade_distance 3 fade_power 2 }
light_source { <-7, 6, -7> rgb <0.10, 0.12, 0.18> shadowless }  // faint cool fill

// ---------- the dark set ----------
sky_sphere { pigment { rgb <0.01, 0.012, 0.018> } }     // near-black surround
plane { y, 0 pigment { rgb <0.02, 0.02, 0.03> }         // matte floor, faint warm pool
  finish { ambient 0 diffuse 0.5 specular 0.12 roughness 0.1 reflection { 0.04, 0.2 } } }

// ---------- star cross-section, reused by every prism ----------
// 10 vertices (5 outer, 5 inner) plus a closing repeat; swept along +Y.
#macro StarPrism(H1, H2, S)
  prism {
    linear_sweep linear_spline
    H1, H2,
    11,
    < 0.0000,  1.6000>, < 0.3592,  0.4944>, < 1.5217,  0.4944>,
    < 0.5812, -0.1889>, < 0.9405, -1.2944>, < 0.0000, -0.6111>,
    <-0.9405, -1.2944>, <-0.5812, -0.1889>, <-1.5217,  0.4944>,
    <-0.3592,  0.4944>, < 0.0000,  1.6000>
    scale <S, 1, S>
  }
#end

// ---------- translucent paper shell (outer prism minus an inner prism) ----------
difference {
  StarPrism(0.0, 3.0, 1.0)
  StarPrism(-0.1, 3.1, 0.9)
  pigment { rgb <1.0, 0.86, 0.6> transmit 0.45 }
  finish { ambient 0 emission 0.28 diffuse 0.5 }
  double_illuminate
}

// ---------- faint emissive interior shell: the glow the silhouette reads off ----------
difference {
  StarPrism(0.2, 2.85, 0.78)
  StarPrism(0.1, 2.95, 0.66)
  pigment { rgb <1.0, 0.66, 0.32> }
  finish { ambient 0 emission 2.4 diffuse 0 }
}

// ---------- bottom frame plate (the dark base the paper is glued to) ----------
cylinder { <0, -0.02, 0>, <0, 0.05, 0>, 0.92
  pigment { rgb <0.06, 0.05, 0.05> }
  finish { ambient 0 diffuse 0.3 specular 0.5 roughness 0.02 } }
`,
  },
  {
    name: 'sweep-knot',
    title: 'Trefoil ribbon (sphere_sweep)',
    category: 'modeling',
    tags: ['sphere_sweep', 'spline', 'trefoil', 'while-loop', 'glossy'],
    description: 'A trefoil knot drawn as one continuous glossy tube with sphere_sweep',
    author: 'povrayer',
    sourceUrl: '',
    license: 'CC0-1.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Trefoil knot drawn as ONE continuous glossy tube with sphere_sweep.
// Curve:  x = sin t + 2 sin 2t,  y = cos t - 2 cos 2t,  z = -sin 3t   (t in 0..2pi)
// Control points are generated in a #while loop; cubic_spline ties them into a
// smooth closed ribbon (the first & last points are tangent controls only).
#version 3.8;
global_settings { assumed_gamma 1.0 }
#include "colors.inc"

camera {
  location <0, 2.4, -10>
  look_at  <0, 0, 0>
  angle 40
}

// ---- studio lighting ----
light_source { <-8, 12, -10> rgb <1.28, 1.2, 1.05>
  area_light x*3, y*3, 3, 3 adaptive 1 jitter }     // soft warm key
light_source { <10, 4, -6> rgb <0.22, 0.30, 0.48> shadowless }   // cool fill
light_source { <0, 6, 10> rgb <0.55, 0.48, 0.5> shadowless }     // back rim

// ---- backdrop & glossy floor ----
sky_sphere {
  pigment {
    gradient y
    color_map {
      [0.0 rgb <0.02, 0.03, 0.05>]
      [0.5 rgb <0.05, 0.07, 0.11>]
      [1.0 rgb <0.01, 0.01, 0.02>]
    }
  }
}
plane { y, -3.3
  pigment { rgb <0.03, 0.03, 0.04> }
  finish { diffuse 0.3 specular 0.4 roughness 0.02 reflection { 0.12, 0.4 } }
}

// ---- the trefoil tube ----
#declare M     = 64;            // segments around the loop
#declare dt    = 2*pi/M;        // angular step
#declare TubeR = 0.34;          // tube radius
#declare NPts  = M + 3;         // M+1 nodes (0..M) + 2 tangent controls

#declare Trefoil =
sphere_sweep {
  cubic_spline
  NPts,
  #declare i = -1;
  #while (i <= M + 1)
    #declare Tk = i*dt;
    <sin(Tk) + 2*sin(2*Tk), cos(Tk) - 2*cos(2*Tk), -sin(3*Tk)>, TubeR
    #declare i = i + 1;
  #end
  tolerance 0.0001
  pigment { rgb <0.86, 0.10, 0.16> }
  finish {
    ambient 0.06 diffuse 0.5
    specular 0.92 roughness 0.004
    reflection { 0.10, 0.35 }
  }
}

object { Trefoil
  scale 0.88
  rotate <-70, 0, 0>
  rotate <0, 26, 0>
}
`,
  },
  {
    name: 'parametric-shell',
    title: 'Logarithmic shell (parametric surface)',
    category: 'implicit',
    tags: ['parametric', 'logarithmic-spiral', 'precompute_depth', 'thin-surface'],
    description: 'A logarithmic-spiral seashell built as a parametric surface',
    author: 'povrayer',
    sourceUrl: '',
    license: 'CC0-1.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Logarithmic-spiral seashell as a parametric {} surface.
// A tube of exponentially growing radius coils along a log spiral; both the
// coil radius and the tube radius scale as e^(B*u), so the whole shell is
// self-similar (a nautilus planispiral). u winds the coil, v wraps the tube.
// Tuned accuracy + precompute so the thin shell lip resolves cleanly.
#version 3.8;
global_settings { assumed_gamma 1.0 }
#include "colors.inc"

camera {
  location <0, 7.5, -11>
  look_at  <0, -0.2, 0>
  angle 40
}

// ---- studio lighting (one crisp key keeps this slow surface cheap) ----
light_source { <-9, 13, -9> rgb <1.3, 1.22, 1.08> }              // warm key
light_source { <11, 5, -6> rgb <0.22, 0.30, 0.45> shadowless }   // cool fill
light_source { <0, 4, 11> rgb <0.5, 0.45, 0.42> shadowless }     // rim

// ---- backdrop & glossy floor ----
sky_sphere {
  pigment {
    gradient y
    color_map {
      [0.0 rgb <0.02, 0.03, 0.05>]
      [0.5 rgb <0.06, 0.07, 0.10>]
      [1.0 rgb <0.01, 0.01, 0.02>]
    }
  }
}
plane { y, -3.2
  pigment { rgb <0.03, 0.03, 0.04> }
  finish { diffuse 0.3 specular 0.4 roughness 0.02 reflection { 0.10, 0.4 } }
}

// ---- shell parameters ----
#declare B  = 0.10;     // log-spiral growth per radian
#declare RT = 0.42;     // tube radius as a fraction of the coil radius
#declare U0 = 2.0;      // inner coil start
#declare U1 = 7*pi;     // ~2.5 turns

// radial(u,v) = e^(B u) * (1 + RT cos v)   ->   the coil radius times tube bulge
#declare Shell =
parametric {
  function { exp(B*u) * (1 + RT*cos(v)) * cos(u) },   // x
  function { RT * exp(B*u) * sin(v) },                 // y  (tube bulges +/- y)
  function { exp(B*u) * (1 + RT*cos(v)) * sin(u) }     // z
  <U0, 0>, <U1, 2*pi>
  contained_by { box { <-13.5, -4.2, -13.5>, <13.5, 4.2, 13.5> } }
  max_gradient 6
  accuracy 0.0015
  precompute 20, x, y, z
  pigment { rgb <0.93, 0.88, 0.80> }       // warm ivory
  finish {
    ambient 0.12 diffuse 0.6
    specular 0.5 roughness 0.02
    brilliance 1.4
    reflection { 0.05, 0.18 }
  }
}

object { Shell
  scale 0.22
  rotate <0, 12, 0>
}
`,
  },
  {
    name: 'algebraic-heart',
    title: 'Algebraic heart (implicit sextic)',
    category: 'implicit',
    tags: ['isosurface', 'algebraic', 'sextic', 'max_gradient', 'glossy'],
    description: 'The heart sextic rendered as a candy-red algebraic isosurface',
    author: 'povrayer',
    sourceUrl: '',
    license: 'CC0-1.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// The Taubin heart sextic rendered as a candy-red algebraic isosurface.
//   f(X,Y,Z) = (X^2 + 9/4 Y^2 + Z^2 - 1)^3 - X^2 Z^3 - 9/80 Y^2 Z^3 = 0
// Mapped so the surface stands upright: world y is the up axis (math Z), world z
// is the thin depth axis (math Y). A max_gradient bound caps the root finder.
#version 3.8;
global_settings { assumed_gamma 1.0 }
#include "colors.inc"

camera {
  location <0, 1.0, -6.2>
  look_at  <0, 0.05, 0>
  angle 36
}

// ---- studio lighting ----
light_source { <-7, 10, -9> rgb <1.32, 1.22, 1.08>
  area_light x*3, y*3, 3, 3 adaptive 1 jitter }      // soft warm key
light_source { <9, 4, -5> rgb <0.24, 0.30, 0.46> shadowless }    // cool fill
light_source { <0, 5, 9> rgb <0.6, 0.5, 0.5> shadowless }        // back rim

// ---- backdrop & glossy floor ----
sky_sphere {
  pigment {
    gradient y
    color_map {
      [0.0 rgb <0.02, 0.03, 0.05>]
      [0.5 rgb <0.06, 0.06, 0.09>]
      [1.0 rgb <0.01, 0.01, 0.02>]
    }
  }
}
plane { y, -1.55
  pigment { rgb <0.03, 0.03, 0.04> }
  finish { diffuse 0.3 specular 0.4 roughness 0.02 reflection { 0.12, 0.4 } }
}

// ---- heart sextic ----
// Taubin's heart is f = inner^3 - rhs = 0, with
//   inner = X^2 + Y^2 + 9/4 Z^2 - 1   and   rhs = X^2 Z^3 + 9/80 Y^2 Z^3,
// mapped to world (X,Y,Z) = (x, z, y) so the lobes face up.
// We render the algebraically identical zero set  inner - cuberoot(rhs) = 0
// instead of the raw sextic: cubing flattens the gradient to ~0 across the
// y=0 waist (where rhs vanishes), which cracks the root finder. The signed
// cube root keeps an O(1) gradient everywhere, so a small max_gradient and a
// coarse accuracy both render clean and cheap.
#declare Inner = function(x, y, z) { x*x + y*y + 2.25*z*z - 1 }
#declare Rhs   = function(x, y, z) { x*x*y*y*y + 0.1125*z*z*y*y*y }
#declare Scbrt = function(q) { select(q, -pow(-q, 1/3), pow(q, 1/3)) }   // signed cube root
#declare Heart = function(x, y, z) { Inner(x, y, z) - Scbrt(Rhs(x, y, z)) }

isosurface {
  function { Heart(x, y, z) }
  contained_by { box { <-1.5, -1.5, -1.05>, <1.5, 1.45, 1.05> } }
  threshold 0
  accuracy 0.001
  max_gradient 5
  pigment { rgb <0.86, 0.07, 0.13> }       // candy red
  finish {
    ambient 0.08 diffuse 0.5
    specular 1.0 roughness 0.004
    brilliance 1.6
    reflection { 0.06, 0.28 }
  }
  scale 1.12
  translate <0, 0.12, 0>
}
`,
  },
  {
    name: 'julia-fractal',
    title: 'Quaternion Julia (julia_fractal)',
    category: 'implicit',
    tags: ['julia_fractal', 'quaternion', 'fractal', 'iridescent', 'metallic'],
    description: 'A quaternion Julia set with an iridescent metallic finish over a dark void',
    author: 'povrayer',
    sourceUrl: '',
    license: 'CC0-1.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Quaternion Julia set as a julia_fractal object, iridescent metallic finish
// floating in a dark gradient void. Tweak the 4D constant for a different
// shape; raise max_iteration / precision for cleaner (slower) detail.
#version 3.8;
global_settings { assumed_gamma 1.0 max_trace_level 6 }
#include "colors.inc"

// ---------- camera ----------
camera { location <3.0, 2.2, -3.4>  look_at <0, 0, 0>  angle 40 }

// ---------- studio lighting: warm key, cool fill, magenta rim ----------
light_source { <9, 12, -9> rgb <1.15, 1.05, 0.92>
  area_light x*2.5, y*2.5, 3, 3 adaptive 1 jitter }     // soft key
light_source { <-10, 4, -5> rgb <0.22, 0.32, 0.6> shadowless }  // cool fill
light_source { <5, -3, 8>  rgb <0.7, 0.18, 0.75> shadowless }   // magenta rim

// ---------- dark gradient void ----------
sky_sphere { pigment { gradient y color_map {
  [0.0 rgb <0.020, 0.012, 0.045>]
  [0.5 rgb <0.006, 0.006, 0.018>]
  [1.0 rgb <0.000, 0.000, 0.010>]
} } }

// faint reflective floor catches the fractal's underside
plane { y, -1.85
  pigment { rgb <0.015, 0.015, 0.025> }
  finish { reflection { 0.18, 0.5 } specular 0.3 roughness 0.02 diffuse 0.1 }
}

// ---------- the quaternion Julia set ----------
// 4D Julia constant; quaternion algebra, z -> z^2 + c iteration.
julia_fractal {
  <-0.083, 0.0, -0.83, -0.025>
  quaternion
  sqr
  max_iteration 11        // iteration depth -> surface detail
  precision 18            // surface-finding accuracy (higher = cleaner, slower)
  slice <0, 0, 0, 1>, 0   // 3D cross-section taken at w = 0

  texture {
    pigment { rgb <0.55, 0.58, 0.62> }   // neutral base; color comes from irid + reflections
    finish {
      ambient 0.05 diffuse 0.28
      specular 0.85 roughness 0.004 metallic
      reflection { 0.30, 0.7 metallic }
      irid { 0.55 thickness 0.5 turbulence 0.4 }   // thin-film iridescence
    }
  }
  rotate <12, 28, 0>
}
`,
  },
  {
    name: 'menger-sponge',
    title: 'Menger sponge (recursive CSG)',
    category: 'generative',
    tags: ['recursion', 'macro', 'menger', 'csg', 'difference'],
    description: 'A level-3 Menger sponge emitted by a recursive CSG macro',
    author: 'povrayer',
    sourceUrl: '',
    license: 'CC0-1.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Level-3 Menger sponge built by a recursive #macro that drills the fractal's
// plus-shaped tunnels out of one solid cube with a single CSG difference.
// Counterpart to helix's #while loop: recursion + booleans instead of iteration.
#version 3.8;
global_settings { assumed_gamma 1.0 max_trace_level 5 }
#include "colors.inc"

#declare MaxLevel = 3;   // recursion depth (3 = classic Menger sponge)
#declare Half     = 1.7; // half-size of the outer cube

// Emit the plus-shaped tunnels removed at this scale, then recurse into each
// of the 20 kept subcubes. Every box here becomes a negative of the enclosing
// difference, so the whole sponge is carved in one boolean subtraction.
#macro MengerHoles(Center, H, Level)
  #local T = H / 3;          // half-thickness of the square tunnels
  #local E = H * 1.002;      // overshoot ends slightly -> no coincident faces
  box { Center + <-E, -T, -T>, Center + <E, T, T> }   // tunnel along x
  box { Center + <-T, -E, -T>, Center + <T, E, T> }   // tunnel along y
  box { Center + <-T, -T, -E>, Center + <T, T, E> }   // tunnel along z
  #if (Level > 1)
    #local Hs   = H / 3;       // subcube half-size
    #local Step = 2 * H / 3;   // subcube center spacing
    #for (I, -1, 1) #for (J, -1, 1) #for (K, -1, 1)
      // keep a subcube unless it is a face-center or the very center
      #if (abs(I) + abs(J) + abs(K) >= 2)
        MengerHoles(Center + <I, J, K> * Step, Hs, Level - 1)
      #end
    #end #end #end
  #end
#end

// ---------- camera & studio lighting ----------
camera { location <5.6, 4.4, -6.6>  look_at <0, 0, 0>  angle 38 }

light_source { <12, 16, -10> rgb <1.2, 1.1, 0.95>
  area_light x*3, y*3, 3, 3 adaptive 1 jitter }          // warm key, soft shadows
light_source { <-12, 5, -6> rgb <0.22, 0.30, 0.5> shadowless }  // cool fill
light_source { <0, -3, 10> rgb <0.55, 0.25, 0.45> shadowless }  // magenta rim

// ---------- dark studio backdrop & polished floor ----------
sky_sphere { pigment { gradient y color_map {
  [0.0 rgb <0.020, 0.020, 0.040>]
  [0.5 rgb <0.040, 0.050, 0.090>]
  [1.0 rgb <0.008, 0.008, 0.020>]
} } }
plane { y, -2.3
  pigment { rgb <0.018, 0.018, 0.028> }
  finish { reflection { 0.20, 0.55 } specular 0.3 roughness 0.02 diffuse 0.1 }
}

// ---------- the sponge: solid cube minus the recursive tunnel union ----------
difference {
  box { <-Half, -Half, -Half>, <Half, Half, Half> }
  MengerHoles(<0, 0, 0>, Half, MaxLevel)
  texture {
    pigment { rgb <0.92, 0.58, 0.18> }   // warm satin metal
    finish { ambient 0.06 diffuse 0.5 specular 0.7 roughness 0.02
             metallic reflection { 0.10, 0.28 metallic } }
  }
  rotate <24, -36, 0>
}
`,
  },
  {
    name: 'agate-light',
    title: 'Backlit agate slabs (procedural pigments)',
    category: 'texturing',
    tags: ['pigment', 'agate', 'marble', 'crackle', 'color_map', 'translucent'],
    description: 'Backlit translucent slabs carved by agate, marble, and crackle pigments',
    author: 'povrayer',
    sourceUrl: '',
    license: 'CC0-1.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Backlit agate slabs: three thin translucent slices butted into a panel on a
// warm lightbox, each carved by a hand-built color_map over a different
// procedural pattern (agate, marble, crackle). The filtered color lets the
// hidden backlight glow through; thin seams between slices leak bright light.
#version 3.8;
global_settings { assumed_gamma 1.0 max_trace_level 8 }

// ---------- camera, framed on the slab wall ----------
camera { location <0, 1.7, -7.2>  look_at <0, 1.6, 0>  angle 51 }

// ---------- the lightbox: a warm emissive panel, hidden behind the slabs ----------
// Sized smaller than the wall on every side, so it is only seen THROUGH the
// translucent slabs (and the thin seams between them), never around them.
box { <-2.95, 0.12, 3.95>, <2.95, 3.36, 4.05>
  pigment { rgb <1.0, 0.97, 0.9> }
  finish { emission 1.9 diffuse 0 } no_shadow }

// real light from behind (passes through the filtered slabs) + soft front fill
light_source { <0, 2.0, 9> rgb <1.05, 0.98, 0.92> * 2.2 }
light_source { <-3.5, 5, -6> rgb 0.2 shadowless }

// ---------- dark room: void sky + faintly reflective floor ----------
sky_sphere { pigment { gradient y color_map {
  [0.0 rgb <0.010, 0.010, 0.018>] [1.0 rgb <0.030, 0.030, 0.050>]
} } }
plane { y, 0
  pigment { rgb <0.020, 0.020, 0.026> }
  finish { reflection { 0.14, 0.42 } specular 0.25 roughness 0.03 diffuse 0.15 }
}

// ---------- a thin translucent slab; Pig is its procedural pigment ----------
#macro Slab(Xpos, Pig)
  box { <-0.98, 0.08, -0.06>, <0.98, 3.4, 0.06>
    texture { pigment { Pig }
      finish { ambient 0.0 diffuse 0.3 specular 0.45 roughness 0.02 } }
    interior { ior 1.45 }
    translate <Xpos, 0, 0>
  }
#end

// carnelian agate: warm bands, brightest where the filter opens up
Slab(-2.0,
  pigment { agate agate_turb 1.1
    color_map {
      [0.00 rgbf <0.55, 0.13, 0.05, 0.58>]
      [0.30 rgbf <0.88, 0.45, 0.14, 0.74>]
      [0.55 rgbf <0.98, 0.80, 0.48, 0.88>]
      [0.75 rgbf <0.82, 0.32, 0.09, 0.74>]
      [1.00 rgbf <0.45, 0.09, 0.04, 0.60>]
    }
    scale 0.85
  })

// teal marble: turbulent veins drifting diagonally
Slab(0.0,
  pigment { marble turbulence 0.6
    color_map {
      [0.00 rgbf <0.04, 0.16, 0.22, 0.40>]
      [0.50 rgbf <0.28, 0.62, 0.68, 0.74>]
      [0.85 rgbf <0.80, 0.95, 0.95, 0.90>]
      [1.00 rgbf <0.03, 0.18, 0.26, 0.45>]
    }
    scale <0.55, 1.6, 1> rotate z*10
  })

// amethyst crackle: bright vein lines at the cell seams
Slab(2.0,
  pigment { crackle turbulence 0.25
    color_map {
      [0.00 rgbf <0.55, 0.22, 0.82, 0.62>]
      [0.10 rgbf <0.85, 0.55, 0.95, 0.86>]
      [0.30 rgbf <0.30, 0.08, 0.45, 0.55>]
      [1.00 rgbf <0.12, 0.02, 0.22, 0.38>]
    }
    scale 0.5
  })
`,
  },
  {
    name: 'normal-study',
    title: 'Normal study (bump patterns under raking light)',
    category: 'texturing',
    tags: ['normal', 'bump', 'dent', 'wrinkle', 'ripple', 'raking-light'],
    description: 'Identical spheres under raking light, each with a different normal pattern',
    author: 'povrayer',
    sourceUrl: '',
    license: 'CC0-1.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// normal-study -- five identical matte clay spheres under one raking light.
// Geometry never changes (every sphere is a plain unit sphere with the SAME
// pigment + finish); the only thing that differs is the normal {} pattern, so
// all the variety you see is fake surface relief from perturbed normals.
// Tweak ideas: drop the key light's y (more grazing -> longer shadows in the
// relief), change each normal's depth (the float after the pattern), or scale.
#version 3.8;
global_settings { assumed_gamma 1.0 }
#include "colors.inc"

camera {
  location <0, 1.6, -12>
  look_at  <0, -0.1, 0>
  angle 50
}

// Single raking key light: low and off to the right so it skims across the
// relief and casts the little shadows that make a bump pattern legible.
light_source {
  <6, 5, -8>
  color rgb <1.0, 0.96, 0.88>
}
// Dim cool fill (shadowless) keeps the dark sides from crushing to black
// without adding a second set of shadows that would muddy the relief.
light_source { <-8, 6, -9> color rgb <0.10, 0.13, 0.20> shadowless }

// Neutral studio sweep: floor the spheres rest on plus a back wall.
#declare Studio = finish { diffuse 0.7 ambient 0 }
plane { y, -0.9 pigment { rgb 0.30 } finish { Studio } }
plane { z,  3.0 pigment { rgb 0.36 } finish { Studio } }

// Shared matte material -- identical on every sphere so the normal pattern is
// the ONLY variable.
#declare ClayPig = pigment { rgb <0.80, 0.75, 0.68> }
#declare ClayFin = finish { diffuse 0.88 ambient 0 specular 0.10 roughness 0.05 }

#macro Relief(Xpos, Norm)
  sphere { <Xpos, 0, 0>, 0.9
    texture {
      pigment { ClayPig }
      normal  { Norm }
      finish  { ClayFin }
    }
  }
#end

// Five reliefs in a row, each a different stdlib normal pattern at a comparable
// depth so the read is a fair side-by-side comparison.
Relief(-4.0, normal { bumps    0.7 scale 0.16 })
Relief(-2.0, normal { dents    0.7 scale 0.28 })
Relief( 0.0, normal { wrinkles 0.6 scale 0.30 })
Relief( 2.0, normal { ripples  0.7 scale 0.35 })
Relief( 4.0, normal { waves    0.6 scale 0.45 })
`,
  },
  {
    name: 'photon-caustics',
    title: 'Caustic ring (photons)',
    category: 'optics',
    tags: ['photons', 'caustics', 'glass', 'torus', 'refraction'],
    description: 'A glass torus focusing a real photon-mapped caustic ring onto a matte floor',
    author: 'povrayer',
    sourceUrl: '',
    license: 'CC0-1.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// photon-caustics -- a real, photon-mapped caustic, not glass's faked interior
// glow. A single bright lamp shoots photons through a flat glass torus; they
// refract and converge into a bright ring of light on the matte floor below.
// Tweak ideas: photons count (higher = tighter, slower), the lamp offset (more
// off-axis = more lopsided ring), or the torus ior.
#version 3.8;
global_settings {
  assumed_gamma 1.0
  // The photon map: count is kept modest so this still doubles as a live draft.
  photons {
    count 30000
    autostop 0
    jitter 0.4
  }
}
#include "colors.inc"

camera {
  location <0, 7.5, -8>
  look_at  <0, 1.0, 0>
  angle 42
}

// The caustic-forming lamp: bright, high, slightly off-axis so the focused
// ring lands a touch asymmetric (more interesting than a perfect circle).
light_source {
  <3, 14, -3>
  color rgb 1.3
}
// Dim shadowless fill so the scene isn't pitch black off the caustic. Its
// photon emission is switched off so it can't smear a second, weaker ring.
light_source {
  <-7, 6, -9>
  color rgb 0.28
  shadowless
  photons { refraction off reflection off }
}

// Matte floor that catches the caustic. Low ambient so the photon ring is the
// brightest thing in frame.
plane { y, 0
  pigment { rgb <0.58, 0.57, 0.55> }
  finish { diffuse 0.85 ambient 0.02 }
}

// The glass torus, lying flat. photons { target } tells POV-Ray to shoot
// refracted photons through it; caustics 0 in the interior disables the OLD
// faked caustic so only the genuine photon ring remains.
torus {
  1.7, 0.55
  translate y*2.6
  texture {
    pigment { rgbf <0.92, 0.96, 1.0, 1.0> }
    finish {
      ambient 0 diffuse 0.04
      specular 0.4 roughness 0.001
      reflection { 0.08, 1.0 fresnel }
    }
  }
  interior { ior 1.5 caustics 0 }
  photons { target refraction on reflection off }
}
`,
  },
  {
    name: 'radiosity-niche',
    title: 'Radiosity niche (color bleed)',
    category: 'lighting',
    tags: ['radiosity', 'color-bleed', 'global-illumination', 'csg-arch'],
    description:
      'One-bounce radiosity bleeding warm and cool walls onto a pale statue in an arched niche',
    author: 'povrayer',
    sourceUrl: '',
    license: 'CC0-1.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// radiosity-niche -- one-bounce global illumination in a stone alcove. A single
// bright sky panel just outside the arch is the ONLY light; everything the
// camera sees inside is carried by radiosity. The warm left wall and cool right
// wall bleed their color onto the pale statue, which is the whole point.
// Tweak ideas: radiosity brightness, wall saturation, or the light's
// fade_distance (smaller = the niche's depths fall darker, statue pops more).
#version 3.8;
global_settings {
  assumed_gamma 1.0
  // One-bounce radiosity carries the sky panel onto the walls and the colored
  // wall-bounce onto the statue. Delete this block and the niche goes flat and
  // dark -- there is no other fill. Higher count = smoother (less speckle).
  radiosity {
    count 450 recursion_limit 1
    error_bound 0.25 nearest_count 14
    pretrace_start 0.08 pretrace_end 0.004
    brightness 1.0
  }
}
#include "colors.inc"

camera {
  location <0, 1.85, -6.4>
  look_at  <0, 1.45, 1.35>
  angle 44
}

// ---- the single sky panel: one big soft light above the arch mouth, angled
// down into the niche, plus a matching emissive box so it reads as glowing sky.
// fade_distance lets the back of the niche fall darker so the statue stands out.
light_source {
  <0, 4.6, -2.0>
  color rgb <0.95, 0.97, 1.05> * 2.0   // cool daylight
  area_light x*4, y*2.0, 8, 7
  adaptive 2 jitter circular
  fade_distance 5.5 fade_power 2
}
box { <-2.4, 3.2, -2.15>, <2.4, 5.6, -2.05>
  pigment { rgb <0.95, 0.97, 1.05> }
  finish { emission 1.0 diffuse 0 } no_shadow }

// ---- materials -----------------------------------------------------------
// Radiosity supplies all the ambient, so every surface is ambient 0. The stone
// is kept fairly dark so it doesn't blow out and the pale statue reads as the
// brightest thing in frame.
#declare PaleStone = texture { pigment { rgb <0.66, 0.64, 0.60> } finish { diffuse 0.9 ambient 0 } }
#declare DarkStone = texture { pigment { rgb <0.46, 0.44, 0.41> } finish { diffuse 0.9 ambient 0 } }
#declare WarmWall  = texture { pigment { rgb <0.88, 0.30, 0.10> } finish { diffuse 0.95 ambient 0 } } // terracotta
#declare CoolWall  = texture { pigment { rgb <0.08, 0.32, 0.60> } finish { diffuse 0.95 ambient 0 } } // slate blue
#declare Alabaster = texture { pigment { rgb <0.84, 0.82, 0.78> } finish { diffuse 0.85 ambient 0 specular 0.15 roughness 0.06 } }

// ---- the niche shell (inner opening is +/-1.25 wide) ----------------------
plane { y, 0 texture { DarkStone } }                                  // floor
box { <-1.35, 0, 0>, <-1.25, 2.6, 3.2> texture { WarmWall } }         // left wall (warm)
box { < 1.25, 0, 0>, < 1.35, 2.6, 3.2> texture { CoolWall } }         // right wall (cool)
box { <-1.35, 0, 3.1>, <1.35, 2.6, 3.2> texture { DarkStone } }       // back wall (dark so the statue pops)

// Barrel-vault ceiling over the niche: a half-cylinder shell carved from two
// concentric cylinders (CSG), seated on the +/-1.25 walls. The curved arch.
difference {
  cylinder { <0, 2.6, -0.05>, <0, 2.6, 3.25>, 1.35 }
  cylinder { <0, 2.6, -0.10>, <0, 2.6, 3.30>, 1.25 }
  box { <-2, -2, -1>, <2, 2.6, 4> }   // keep only the upper half -> a vault
  texture { PaleStone }
}

// Front arch frame: a flat slab with an arched portal cut out (box + cylinder
// union subtracted), framing the view into the niche. The second CSG arch.
difference {
  box { <-2.2, 0, -0.12>, <2.2, 4.2, 0.0> }
  union {
    box      { <-1.25, -0.1, -0.2>, <1.25, 2.6, 0.1> }
    cylinder { <0, 2.6, -0.2>, <0, 2.6, 0.1>, 1.25 }
  }
  texture { PaleStone }
}

// ---- the pale statue: a simple bust on a column, centered so its left side
// catches warm bounce and its right side catches cool. ---------------------
union {
  cylinder { <0, 0, 1.35>, <0, 1.05, 1.35>, 0.36 }                          // column
  sphere   { <0, 0, 0>, 0.5 scale <0.64, 0.54, 0.46> translate <0, 1.40, 1.35> } // shoulders
  sphere   { <0, 1.92, 1.35>, 0.29 }                                        // head
  texture { Alabaster }
}
`,
  },
  {
    name: 'soft-shadow-colonnade',
    title: 'Soft-shadow colonnade (area light)',
    category: 'lighting',
    tags: ['area-light', 'soft-shadow', 'penumbra', 'jitter', 'adaptive'],
    description: 'An area light grading penumbra wider with distance across a colonnade',
    author: 'povrayer',
    sourceUrl: '',
    license: 'CC0-1.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Soft-shadow colonnade -- a focused study of area-light penumbra.
// One big square area light (adaptive + jitter + orient) rakes across a row of
// stone columns; the cast shadows stretch down the floor and visibly soften
// toward their tips and toward the far end of the colonnade.
// Knobs: LightSize widens every penumbra; ColCount lengthens the row;
// the light height sets how long (and thus how soft) the shadows stretch.
#version 3.8;
global_settings { assumed_gamma 1.0 }
#include "colors.inc"

#declare LightSize = 5.0;   // bigger square light = softer shadows everywhere
#declare ColCount  = 7;     // columns marching into the distance

camera {
  location <-6.8, 2.9, -11.0>
  look_at  <1.6, 1.4, 8.5>
  angle 48
}

// warm raking sky so the open colonnade has depth behind it
sky_sphere {
  pigment { gradient y color_map {
    [0.00 rgb <0.78, 0.64, 0.46>] [0.30 rgb <0.58, 0.56, 0.60>]
    [0.72 rgb <0.30, 0.42, 0.62>] [1.00 rgb <0.16, 0.26, 0.48>] } }
}

// ---- the area light: this is the whole point of the scene ----
// orient + circular makes the panel face each shaded point as a disc, so the
// penumbra grades smoothly; adaptive + jitter keep 5x5 sampling cheap + clean.
light_source {
  <16, 8.0, 1>
  rgb <1.55, 1.38, 1.12>
  area_light x*LightSize, z*LightSize, 5, 5
  adaptive 1 jitter circular orient
}
// faint cool sky-fill so the soft shadows aren't crushed to black
light_source { <-12, 7, -6> rgb <0.16, 0.20, 0.30> shadowless }

// ---- limestone floor: catches the graded shadows ----
plane { y, 0
  texture {
    pigment { rgb <0.80, 0.75, 0.64> }
    normal { granite 0.12 scale 0.5 }
    finish { diffuse 0.85 ambient 0.05 specular 0.10 roughness 0.10 }
  }
}

// ---- one classical column (base, tapered shaft, flared capital, abacus) ----
#declare StoneTex = texture {
  pigment { rgb <0.86, 0.81, 0.70> }
  normal { granite 0.08 scale 0.4 }
  finish { diffuse 0.80 ambient 0.06 specular 0.12 roughness 0.08 }
};

#macro Column(Z)
  union {
    box  { <-0.62, 0.00, -0.62>, <0.62, 0.30, 0.62> }   // plinth
    cone { <0, 0.30, 0>, 0.50, <0, 0.46, 0>, 0.44 }     // base moulding
    cone { <0, 0.46, 0>, 0.44, <0, 3.70, 0>, 0.39 }     // shaft (slight entasis)
    cone { <0, 3.70, 0>, 0.39, <0, 3.96, 0>, 0.56 }     // echinus flare
    box  { <-0.64, 3.96, -0.64>, <0.64, 4.26, 0.64> }   // abacus slab
    texture { StoneTex }
    translate <2.8, 0, Z>
  }
#end

#declare i = 0;
#while (i < ColCount)
  Column(-1.6 + i*2.6)
  #declare i = i + 1;
#end
`,
  },
  {
    name: 'god-rays',
    title: 'God rays (scattering media)',
    category: 'environment',
    tags: ['media', 'scattering', 'volumetric', 'spotlight', 'god-rays'],
    description: 'Volumetric light shafts from a spotlight raking through window slats',
    author: 'povrayer',
    sourceUrl: '',
    license: 'CC0-1.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// God rays -- real scattering media, not a fog fake.
// A hollow transparent box is filled with scattering media. A tight spotlight
// rakes through a row of slats; where the cone crosses the media it scatters
// light back to the camera as a luminous shaft, and the slats carve it into
// banded volumetric beams. The room surfaces are kept dark so the lit AIR is
// the brightest thing in frame.
// Notes for tweakers:
//   - MediaDensity sets how thick/bright the shafts read.
//   - The slats are plain floating boxes (NOT a CSG window): a difference{}
//     wall stops a spotlight from lighting media through its opening, while
//     simple box occluders shadow the media correctly.
#version 3.8;
global_settings { assumed_gamma 1.0 }

#declare MediaDensity = 0.6;   // scattering coefficient -> shaft brightness

camera {
  location <0.8, 2.7, -9.5>
  look_at  <-1.3, 1.6, 3.4>
  angle 56
}

// ---- the spotlight: a tight warm cone raking down through the slats ----
light_source {
  <-11.5, 7.8, 0.6>
  rgb <3.7, 3.1, 2.25>
  spotlight
  point_at <-1.4, 1.1, 2.3>
  radius 23 falloff 30 tightness 5
}

// ---- dark room shell so the volumetric shafts dominate ----
plane { y, 0    pigment { rgb 0.07 } finish { ambient 0.015 diffuse 0.6 } }   // floor
plane { z, 6.5  pigment { rgb 0.07 } finish { ambient 0.015 diffuse 0.6 } }   // back wall

// ---- the window slats: vertical bars the cone shines between ----
#declare SlatTex = texture { pigment { rgb 0.03 } finish { ambient 0.015 } };
#declare zz = -2.2;
#while (zz < 5.6)
  box { <-5.1, 0.7, zz>, <-4.9, 5.3, zz + 0.6> texture { SlatTex } }
  #declare zz = zz + 1.45;
#end

// ---- the participating-media container: big, hollow, transparent ----
// hollow = the media fills the interior; the camera sits outside the -z face so
// its rays enter and integrate the lit cone cleanly. intervals 1 with method 3
// is the supported adaptive-sampling combo (intervals > 1 disables it here).
box {
  <-4.7, 0.03, -5.9>, <4.9, 5.95, 6.4>
  pigment { rgbt 1 }
  hollow
  no_shadow
  interior {
    media {
      method 3
      intervals 1
      samples 50
      scattering { 1, rgb MediaDensity }
    }
  }
}
`,
  },
  {
    name: 'heightfield-dunes',
    title: 'Dunes (height field from a function)',
    category: 'environment',
    tags: ['height_field', 'function', 'turbulence', 'sunset', 'terrain'],
    description: 'Dunes built from a turbulent sin field as a function-driven height field',
    author: 'povrayer',
    sourceUrl: '',
    license: 'CC0-1.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Dunes -- a height_field driven by an SDL function instead of an image.
// A turbulent sin field is sampled on a grid to raise sand dunes; a low warm
// sun rakes across them so the crests throw long shadows down the lee slopes.
// Knobs: the function below shapes the dunes; lowering the sun light_source
// (its y) lengthens the shadows; HF_Res trades detail for render cost.
#version 3.8;
global_settings { assumed_gamma 1.0 }
#include "functions.inc"
#include "colors.inc"

#declare HF_Res = 600;   // height-field grid resolution

// camera: low and looking across the dune field into the setting sun
camera {
  location <0, 4.6, -33>
  look_at  <3.0, 3.4, 10>
  angle 62
}

// warm sunset sky -- pink-gold at the horizon climbing to dusk blue.
// scale 2 / translate maps ray-direction y in [-1,1] monotonically onto the
// color_map so grazing (slightly downward) rays stay warm instead of wrapping.
sky_sphere {
  pigment {
    gradient y
    color_map {
      [0.00 rgb <0.86, 0.62, 0.42>]   // straight down (mostly occluded)
      [0.50 rgb <0.98, 0.66, 0.40>]   // horizon: warm gold-pink
      [0.62 rgb <0.80, 0.50, 0.44>]
      [0.80 rgb <0.40, 0.33, 0.48>]
      [1.00 rgb <0.15, 0.18, 0.40>]   // zenith: dusk blue
    }
    scale 2
    translate y*-1
  }
}

// low raking sun off to the west -> lit windward faces, shadowed troughs
light_source { <-58, 15, -26> rgb <1.95, 1.20, 0.62> }
// faint cool fill so shadowed faces keep a little dusk bounce
light_source { <35, 26, -28> rgb <0.13, 0.14, 0.20> shadowless }

// warm haze fades the far dunes into the sky
fog { fog_type 1 distance 88 color rgb <0.82, 0.58, 0.42> }

// ---- the dunes: a function-built height field ----
// Big wind ridges (sin warped by noise) + rolling variation + fine ripples.
// All terms keep the result inside [0,1] as height_field requires.
height_field {
  function HF_Res, HF_Res {
    0.40
    + 0.30 * sin( x*5.2 + 2.2*f_noise3d(x*1.2, y*1.2, 0.0) )   // dune ridges
    + 0.12 * f_noise3d(x*2.6, y*2.6, 1.7)                      // rolling drift
    + 0.05 * sin( x*34 + y*5 )                                 // wind ripples
  }
  smooth
  scale <62, 8.5, 62>
  translate <-31, 0, -31>
  texture {
    pigment { rgb <0.86, 0.69, 0.44> }
    normal { granite 0.10 scale 0.25 }
    finish { diffuse 0.9 ambient 0.06 specular 0.04 roughness 0.3 }
  }
}
`,
  },
  {
    name: 'focus-pull',
    title: 'Rack focus (animated depth of field)',
    category: 'camera',
    tags: ['clock', 'depth-of-field', 'focal_point', 'aperture', 'rack-focus'],
    description: 'Clock racks the camera focus and aperture from a near object to a far one',
    author: 'povrayer',
    sourceUrl: '',
    license: 'CC0-1.0',
    animated: true,
    frames: 24,
    fps: 12,
    source: `// Rack Focus -- depth of field as motion.
// clock (0..1) eases the focal_point down a receding row of marbles and back
// via a cosine, so the plane of sharpness rolls from the near marble to the
// far one and returns for a seamless loop. aperture breathes a touch wider when
// the focus settles on a target. Animate ~24 frames; a still freezes one depth.
#version 3.8;
global_settings { assumed_gamma 1.0 }
#include "colors.inc"

// --- rack-focus drive -------------------------------------------------------
#declare Ease     = (1 - cos(clock * 2 * pi)) / 2;        // 0 -> 1 -> 0, loops
#declare NearZ    = 2.0;                                  // sharp at clock 0,1
#declare FarZ     = 16.0;                                 // sharp at clock 0.5
#declare FocusZ   = NearZ + (FarZ - NearZ) * Ease;
#declare Aperture = 0.26 + 0.14 * abs(cos(clock * 2 * pi)); // wider on a target

camera {
  location <-0.6, 1.5, -4.2>  look_at <0.2, 0.8, 8>  angle 40
  aperture Aperture
  focal_point <0.2, 0.8, FocusZ>
  blur_samples 34  confidence 0.9  variance 1/160
}

light_source { <-7, 9, -6> rgb <1.18, 1.05, 0.88> }            // warm key
light_source { <8, 4, -2>  rgb <0.16, 0.20, 0.34> shadowless } // cool fill

// dusk-to-night gradient sky
sky_sphere { pigment { gradient y color_map {
  [0.00 rgb <0.05, 0.03, 0.02>] [0.30 rgb <0.02, 0.02, 0.04>]
  [1.00 rgb <0.005, 0.008, 0.02>] } } }

// night fog sinks the far end so the bokeh lights pop
fog { distance 26 color rgb <0.01, 0.01, 0.025> }

// dark glossy floor
plane { y, 0
  texture { pigment { rgb <0.02, 0.02, 0.03> }
    finish { reflection { 0.12, 0.4 } specular 0.4 roughness 0.012 diffuse 0.15 } } }

// shared glassy-glossy marble finish (fresnel = stronger edge reflections)
#declare Gloss = finish { ambient 0.03 diffuse 0.6 specular 1.0
  roughness 0.0009 reflection { 0.05, 0.5 fresnel } conserve_energy }

// a marble on the receding row at depth Z, hue cycling down the line
#macro Target(X, Z, Col)
  sphere { <X, 0.55, Z>, 0.55
    texture { pigment { rgb Col } finish { Gloss } }
    interior { ior 1.5 } }
#end

Target(-0.9,  2.0, <0.88, 0.12, 0.08>)   // near hero (sharp at clock 0)
Target( 0.7,  4.3, <0.92, 0.55, 0.10>)
Target(-0.6,  6.8, <0.85, 0.80, 0.12>)
Target( 0.8,  9.2, <0.20, 0.70, 0.30>)
Target(-0.5, 11.6, <0.12, 0.55, 0.85>)
Target( 0.6, 13.9, <0.30, 0.25, 0.80>)
Target(-0.3, 16.0, <0.72, 0.18, 0.62>)   // far target (sharp at clock 0.5)

// fairy lights far behind -> big soft bokeh discs when focus is elsewhere
#declare Glow = finish { emission 3.0 diffuse 0 ambient 0 }
#macro Bokeh(P, C) sphere { P, 0.3 pigment { rgb C } finish { Glow } no_shadow } #end
Bokeh(<-3.0, 2.2, 22>, <1.0, 0.70, 0.30>)
Bokeh(< 3.2, 1.6, 24>, <0.45, 0.80, 1.0>)
Bokeh(<-1.0, 3.0, 26>, <1.0, 0.50, 0.60>)
Bokeh(< 4.6, 2.6, 23>, <1.0, 0.85, 0.40>)
Bokeh(< 1.4, 1.0, 20>, <0.50, 1.0, 0.70>)
`,
  },
  {
    name: 'pendulum-wave',
    title: 'Pendulum wave (clock-driven)',
    category: 'motion',
    tags: ['clock', 'pendulum', 'phase', 'oscillation', 'seamless-loop'],
    description: 'An array of pendulums with index-stepped periods drifting in and out of phase',
    author: 'povrayer',
    sourceUrl: '',
    license: 'CC0-1.0',
    animated: true,
    frames: 60,
    fps: 30,
    source: `// Pendulum Wave -- a row of pendulums drifting in and out of phase.
// Each pendulum i swings angle = Amp*cos(2*pi*clock*Cycles_i) where the cycle
// count steps up by one across the row (BaseCycles .. BaseCycles+N-1). Integer
// cycle counts mean every pendulum returns to its start at clock=1, so the
// snake winds tight, scatters, and realigns once -- a seamless loop. Animate
// the full 60 frames; a still freezes one phase (clock=0 -> all swung alike).
#version 3.8;
global_settings { assumed_gamma 1.0 }

#declare N          = 11;      // number of pendulums
#declare BaseCycles = 2;       // slowest does 2 swings per loop, fastest 12
#declare AmpDeg     = 32;      // swing amplitude (degrees)
#declare Spacing    = 0.7;
#declare PivotY     = 4.0;
#declare Len        = 3.0;     // string length
#declare BobR       = 0.22;

camera { location <-5.5, 3.4, -7.5> look_at <0, 2.0, 0> angle 46 }

light_source { <-9, 12, -8> rgb <1.15, 1.05, 0.90> }            // warm key
light_source { <8, 5, -5>   rgb <0.16, 0.20, 0.34> shadowless } // cool fill

// near-black studio backdrop with the faintest cool lift
sky_sphere { pigment { gradient y color_map {
  [0.0 rgb <0.006, 0.008, 0.014>] [1.0 rgb <0.02, 0.03, 0.05>] } } }

// dark reflective floor catches the bobs
plane { y, 0
  pigment { rgb <0.015, 0.015, 0.022> }
  finish { reflection { 0.18, 0.5 } specular 0.3 roughness 0.02 diffuse 0.12 } }

// cool-to-warm hue ramp so the spatial wave reads in color
#declare ColA = <0.10, 0.50, 0.95>;   // blue
#declare ColB = <0.95, 0.85, 0.20>;   // yellow
#declare ColC = <0.96, 0.24, 0.30>;   // red
#macro Hue(P)
  (P < 0.5
    ? ColA + (ColB - ColA) * (P / 0.5)
    : ColB + (ColC - ColB) * ((P - 0.5) / 0.5))
#end

// one pendulum: string + bob hung at the pivot, swung about the support bar (x)
#macro Pendulum(X, Cycles, Col)
  #local AngDeg = AmpDeg * cos(2 * pi * clock * Cycles);  // animated swing
  union {
    cylinder { <0, 0, 0>, <0, -Len, 0>, 0.012
      pigment { rgb <0.5, 0.5, 0.55> } finish { ambient 0.2 diffuse 0.5 } }
    sphere { <0, -Len, 0>, BobR
      texture { pigment { rgb Col }
        finish { ambient 0.05 diffuse 0.55 specular 0.9 roughness 0.012
                 reflection { 0.06, 0.4 fresnel } conserve_energy } } }
    rotate x * AngDeg
    translate <X, PivotY, 0>
  }
#end

// the support frame: a bar across the top on two posts
#declare FrameTex = texture { pigment { rgb <0.20, 0.21, 0.24> }
  finish { ambient 0.08 diffuse 0.4 specular 0.5 roughness 0.03 metallic
           reflection { 0.10, 0.3 metallic } } }
#declare Half = (N - 1) / 2 * Spacing;
cylinder { <-Half - 0.6, PivotY, 0>, <Half + 0.6, PivotY, 0>, 0.05 texture { FrameTex } }
cylinder { <-Half - 0.6, 0, 0>, <-Half - 0.6, PivotY, 0>, 0.06 texture { FrameTex } }
cylinder { < Half + 0.6, 0, 0>, < Half + 0.6, PivotY, 0>, 0.06 texture { FrameTex } }

// lay out the row, cycle counts stepping up by index
#for (I, 0, N - 1)
  #local P = I / (N - 1);
  Pendulum((I - (N - 1) / 2) * Spacing, BaseCycles + I, Hue(P))
#end
`,
  },
  {
    name: 'spin-gears',
    title: 'Meshing gears (clock-driven CSG)',
    category: 'motion',
    tags: ['clock', 'csg', 'gears', 'coupled-rotation', 'seamless-loop'],
    description: 'Two meshing CSG gears rotating at coupled gear-ratio speeds',
    author: 'povrayer',
    sourceUrl: '',
    license: 'CC0-1.0',
    animated: true,
    frames: 48,
    fps: 24,
    source: `// Spin Gears -- two meshing CSG gears on a turntable of clockwork.
// Each gear is pure CSG: a body cylinder unioned with rectangular teeth, the
// center bore cut by difference. They share one module (tooth pitch), so a
// 12-tooth and an 18-tooth gear mesh. clock rotates them at the coupled ratio
// (A one full turn, B two-thirds of a turn, counter-rotating) so the teeth pass
// one-for-one and the loop is seamless. Animate ~48 frames; clock=0 is a still.
#version 3.8;
global_settings { assumed_gamma 1.0 }

#declare Na = 12;          // gear A teeth
#declare Nb = 18;          // gear B teeth (ratio 2:3)
#declare PitchA = 2.0;     // pitch radius scales with tooth count (same module)
#declare PitchB = 3.0;
#declare Center = PitchA + PitchB;   // pitch circles tangent at the mesh line

camera { location <0.2, 2.6, -11.5> look_at <0.3, -0.2, 0> angle 52 }

light_source { <-10, 11, -9> rgb <1.20, 1.06, 0.86> }           // warm key
light_source { <9, 4, -6>    rgb <0.18, 0.22, 0.34> shadowless } // cool fill
light_source { <2, 8, -3>    rgb <0.5, 0.5, 0.55> shadowless }   // soft top glint

// near-black studio with a faint cool gradient
sky_sphere { pigment { gradient y color_map {
  [0.0 rgb <0.006, 0.008, 0.014>] [1.0 rgb <0.02, 0.026, 0.04>] } } }

// dark mounting plate behind the gears
plane { z, 2.9
  pigment { rgb <0.03, 0.032, 0.04> }
  finish { ambient 0.05 diffuse 0.4 specular 0.2 roughness 0.05
           reflection { 0.05, 0.25 } } }

// metals
#declare BrassTex = texture {
  pigment { rgb <0.82, 0.60, 0.22> }
  finish { ambient 0.06 diffuse 0.40 brilliance 2 metallic
           specular 0.7 roughness 0.02 reflection { 0.22, 0.5 metallic } } }
#declare SteelTex = texture {
  pigment { rgb <0.60, 0.64, 0.71> }
  finish { ambient 0.06 diffuse 0.38 brilliance 2 metallic
           specular 0.8 roughness 0.015 reflection { 0.28, 0.55 metallic } } }

// a spur gear: body disc + rectangular teeth (union), bored center (difference)
#macro Gear(Pitch, Nteeth, Tex)
  #local Root  = Pitch - 0.22;                 // dedendum
  #local Outer = Pitch + 0.22;                 // addendum
  #local Th    = 0.55;                         // axial thickness
  #local TW    = pi * Pitch / Nteeth * 0.46;   // tooth half-width (shared module, some backlash)
  #local Bore  = 0.42;
  difference {
    union {
      cylinder { <0, 0, -Th/2>, <0, 0, Th/2>, Root }
      #local K = 0;
      #while (K < Nteeth)
        box { <Root - 0.06, -TW, -Th/2>, <Outer, TW, Th/2>
          rotate z * (K * 360 / Nteeth) }
        #local K = K + 1;
      #end
    }
    cylinder { <0, 0, -Th>, <0, 0, Th>, Bore }
    texture { Tex }
  }
#end

#declare GearA = object { Gear(PitchA, Na, BrassTex) }
#declare GearB = object { Gear(PitchB, Nb, SteelTex) }

// coupled rotation: A turns clock*360, B counter-turns clock*360*(Na/Nb).
// the +10 deg static phase seats A's tooth into B's gap at the mesh line.
object { GearA rotate z * (clock * 360)               translate <-PitchA, 0, 0> }
object { GearB rotate z * (10 - clock * 360 * Na/Nb)  translate < PitchB, 0, 0> }

// static axle shafts the gears spin on
#declare AxleTex = texture { pigment { rgb <0.10, 0.11, 0.13> }
  finish { ambient 0.1 diffuse 0.4 specular 0.5 roughness 0.04 metallic } }
cylinder { <-PitchA, 0, -0.3>, <-PitchA, 0, 2.8>, 0.40 texture { AxleTex } }
cylinder { < PitchB, 0, -0.3>, < PitchB, 0, 2.8>, 0.40 texture { AxleTex } }
`,
  },
  ...SOURCED_EXAMPLES,
];

export const EXAMPLES = CORE_EXAMPLES.map(addExampleMetadata);
export const FEATURED_EXAMPLES = FEATURED_EXAMPLE_NAMES.map((name) => getExampleRecord(name));

// FROZEN contract: both ui.js and repl.js depend on this exact signature.
export function getExample(name) {
  return EXAMPLES.find((e) => e.name === name)?.source;
}

// Full record for the browser example-picker + the clock autoset; undefined if
// the name is unknown (the `find` miss feeds the optional chain in callers).
export function getExampleRecord(name) {
  return EXAMPLES.find((e) => e.name === name);
}

// Scenes grouped in CATEGORIES order for the gallery / docs. Branch-free on purpose:
// no `.length` filter (a dead false-arm under the 100% gate, since the node
// test guarantees every category has at least one member).
export function groupAllByCategory() {
  return CATEGORIES.map((c) => ({
    key: c.key,
    label: c.label,
    items: EXAMPLES.filter((e) => e.category === c.key),
  }));
}

// Featured subset for the compact dropdown. Gallery-only examples still load
// through getExampleRecord()/getExample(); this just keeps the picker curated.
export function groupByCategory() {
  return CATEGORIES.map((c) => ({
    key: c.key,
    label: c.label,
    items: FEATURED_EXAMPLES.filter((e) => e.category === c.key),
  }));
}
