// Example POV-Ray SDL scenes shared by the UI page and the REPL.
// Pure data module, no DOM. Each scene has been render-verified against the
// dist/ wasm build (notably: this build's glass.inc has no M_Glass* materials,
// so the glass example uses texture { T_Glass3 } + interior { I_Glass }).
//
// Order here is the select order on the UI page: csg-die leads as the
// default first impression (fast render, classic raytracer subject).

export const EXAMPLES = [
  {
    name: 'csg-die',
    title: 'CSG dice (superellipsoid difference)',
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
];

export function getExample(name) {
  return EXAMPLES.find((e) => e.name === name)?.source;
}
