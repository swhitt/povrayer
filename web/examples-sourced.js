// Sourced POV-Ray SDL scene adaptations kept separate from the in-house examples.
// Imported by examples.js so the public EXAMPLES order and API stay unchanged.
const officialSceneUrl = (path) =>
  `https://github.com/POV-Ray/povray/blob/master/distribution/scenes/${path}`;

export const SOURCED_EXAMPLES = [
  {
    name: 'sourced-chess2',
    title: 'Chess study (CC-BY-SA sample adaptation)',
    category: 'modeling',
    tags: ['chess', 'csg', 'lathe', 'board', 'sample'],
    description: 'A compact chessboard study adapted from the POV-Ray sample scene',
    author: 'Ville Saari / Dan Farmer',
    sourceUrl:
      'https://github.com/POV-Ray/povray/blob/master/distribution/scenes/advanced/chess2.pov',
    license: 'CC-BY-SA-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's chess2.pov sample by Ville Saari and Dan Farmer.
#version 3.8;
global_settings { assumed_gamma 1.0 }
#include "colors.inc"

camera { location <6, 5, -8> look_at <0, 0.8, 0> angle 42 }
light_source { <-4, 7, -5> color rgb <1.2, 1.1, 0.95> area_light x*2, y*2, 3, 3 adaptive 1 }
light_source { <4, 3, -2> color rgb <0.25, 0.35, 0.55> shadowless }

#declare WhitePiece = texture { pigment { color rgb <0.9, 0.78, 0.55> }
  finish { specular 0.55 roughness 0.02 reflection 0.08 } }
#declare BlackPiece = texture { pigment { color rgb <0.20, 0.10, 0.055> }
  finish { specular 0.5 roughness 0.018 reflection 0.12 } }
#declare BoardWhite = texture { pigment { color rgb <0.9, 0.86, 0.78> } finish { specular 0.25 } }
#declare BoardBlack = texture { pigment { color rgb <0.18, 0.14, 0.12> } finish { specular 0.25 } }

#macro Pawn(Tex)
  union {
    sphere { <0, 1.15, 0>, 0.22 }
    cone { <0, 0.28, 0>, 0.28, <0, 1.02, 0>, 0.12 }
    torus { 0.24, 0.045 translate y*0.28 }
    cylinder { <0, 0, 0>, <0, 0.12, 0>, 0.33 }
    texture { Tex }
  }
#end

plane { y, -0.03 pigment { color rgb <0.04, 0.045, 0.05> }
  finish { diffuse 0.4 specular 0.35 roughness 0.015 reflection { 0.08, 0.24 } } }
box { <-2.45, 0, -2.45>, <2.45, 0.08, 2.45>
  texture { checker texture { BoardWhite } texture { BoardBlack } scale 0.6 } }
box { <-2.62, -0.08, -2.62>, <2.62, 0, 2.62>
  texture { pigment { color rgb <0.32, 0.18, 0.08> } finish { specular 0.35 roughness 0.02 } } }

#for (I, -3, 3)
  object { Pawn(WhitePiece) scale 0.75 translate <I*0.6, 0.08, -1.5> }
  object { Pawn(BlackPiece) scale 0.75 translate <I*0.6, 0.08, 1.5> }
#end
`,
  },
  {
    name: 'sourced-wineglass',
    title: 'Wine glass (CC-BY-SA sample adaptation)',
    category: 'optics',
    tags: ['glass', 'refraction', 'wine', 'checkerboard', 'sample'],
    description: 'A transparent goblet and red wine over a small checkerboard',
    author: 'Dan Farmer',
    sourceUrl:
      'https://github.com/POV-Ray/povray/blob/master/distribution/scenes/advanced/wineglass.pov',
    license: 'CC-BY-SA-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's wineglass.pov sample by Dan Farmer.
#version 3.8;
global_settings { assumed_gamma 1.0 max_trace_level 8 }
#include "colors.inc"

camera { location <3.6, 3.0, -6.5> look_at <0, 1.1, 0> angle 38 }
light_source { <-5, 7, -5> color rgb <1.2, 1.05, 0.85> area_light x*2, y*2, 3, 3 adaptive 1 }
light_source { <4, 4, -2> color rgb <0.35, 0.45, 0.7> shadowless }

#declare GlassTex = texture {
  pigment { color rgbf <0.92, 0.98, 1, 0.82> }
  finish { diffuse 0.02 specular 0.9 roughness 0.004 reflection { 0.05, 0.25 } }
}
#declare WineTex = texture {
  pigment { color rgbf <0.85, 0.02, 0.08, 0.35> }
  finish { specular 0.7 roughness 0.01 reflection 0.08 }
}

plane { y, 0 pigment { checker color rgb <0.05, 0.05, 0.06>, color rgb <0.86, 0.84, 0.78> scale 0.55 }
  finish { specular 0.45 roughness 0.015 reflection { 0.08, 0.22 } } }
torus { 0.52, 0.035 translate y*2.0 texture { GlassTex } interior { ior 1.45 } }
cone { <0, 0.75, 0>, 0.34, <0, 2.0, 0>, 0.55 open texture { GlassTex } interior { ior 1.45 } }
cone { <0, 0.82, 0>, 0.28, <0, 1.38, 0>, 0.45 texture { WineTex } interior { ior 1.35 } }
disc { <0, 1.38, 0>, y, 0.45 texture { WineTex } interior { ior 1.35 } }
cylinder { <0, 0.18, 0>, <0, 0.78, 0>, 0.075 texture { GlassTex } interior { ior 1.45 } }
torus { 0.38, 0.04 translate y*0.17 texture { GlassTex } interior { ior 1.45 } }
`,
  },
  {
    name: 'sourced-infinity-box',
    title: 'Infinity box (CC-BY-SA sample adaptation)',
    category: 'optics',
    tags: ['reflection', 'box', 'mirrors', 'recursion', 'sample'],
    description: 'Mirrored interior walls repeat colored forms into a compact infinity box',
    author: 'Chris Huff',
    sourceUrl:
      'https://github.com/POV-Ray/povray/blob/master/distribution/scenes/advanced/infinitybox.pov',
    license: 'CC-BY-SA-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's InfinityBox.pov sample by Chris Huff.
#version 3.8;
global_settings { assumed_gamma 1.0 max_trace_level 18 }

camera { location <2.4, 2.6, -5.8> look_at <0, 1, 0> angle 38 }
light_source { <2.4, 2.6, -5.8> color rgb 0.35 }
light_source { <-5, 8, -4> color rgb <1, 0.92, 0.8> }

#declare Mirror = texture { pigment { color rgb <0.9, 0.95, 1> }
  finish { ambient 0 diffuse 0.02 reflection { 0.82, 0.98 } specular 1 roughness 0.002 } }
plane { y, 0 pigment { checker color rgb <0.1, 0.08, 0.18>, color rgb <0.85, 0.84, 0.78> scale 0.35 }
  finish { specular 0.35 reflection 0.12 } }
box { <-1.35, 0.02, -1.35>, <-1.30, 2.5, 1.35> texture { Mirror } }
box { <1.30, 0.02, -1.35>, <1.35, 2.5, 1.35> texture { Mirror } }
box { <-1.35, 0.02, 1.30>, <1.35, 2.5, 1.35> texture { Mirror } }
box { <-1.35, 2.45, -1.35>, <1.35, 2.5, 1.35> texture { Mirror } }
sphere { <0.35, 1.55, 0.25>, 0.33 pigment { color rgb <0.8, 0.05, 0.04> }
  finish { metallic specular 0.9 roughness 0.006 reflection 0.4 } }
sphere { <-0.45, 0.62, -0.20>, 0.13 pigment { color rgb <1, 0.85, 0.05> }
  finish { metallic specular 0.8 roughness 0.01 reflection 0.25 } }
box { <-0.25, 0.22, -0.18>, <0.55, 0.42, 0.18> rotate y*20
  pigment { color rgb <0.02, 0.7, 0.2> } finish { specular 0.6 reflection 0.25 } }
`,
  },
  {
    name: 'sourced-isocacti',
    title: 'Iso cacti (CC-BY-SA sample adaptation)',
    category: 'implicit',
    tags: ['isosurface', 'cactus', 'function', 'desert', 'sample'],
    description: 'Ribbed isosurface cacti rise from a simple desert floor',
    author: 'POV-Ray sample scene authors',
    sourceUrl:
      'https://github.com/POV-Ray/povray/blob/master/distribution/scenes/advanced/isocacti.pov',
    license: 'CC-BY-SA-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's isocacti.pov sample.
#version 3.8;
global_settings { assumed_gamma 1.0 }
#include "functions.inc"

camera { location <4, 2.8, -6> look_at <0, 1.0, 0> angle 43 }
light_source { <-5, 7, -4> color rgb <1.1, 0.9, 0.65> area_light x*2, y*2, 3, 3 adaptive 1 }
sky_sphere { pigment { gradient y color_map { [0 color rgb <0.9, 0.55, 0.28>] [1 color rgb <0.25, 0.45, 0.9>] } } }
plane { y, 0 pigment { color rgb <0.56, 0.36, 0.18> }
  normal { wrinkles 0.18 scale 0.7 } finish { diffuse 0.82 } }

#declare CactusTex = texture {
  pigment { color rgb <0.08, 0.38, 0.14> }
  normal { radial 0.25 frequency 10 }
  finish { specular 0.2 roughness 0.04 }
}
#macro Cactus(Pos, S)
  union {
    isosurface {
      function { sqrt(x*x+z*z) - (0.28 + 0.035*sin(atan2(x,z)*10)) }
      contained_by { box { <-0.38, 0, -0.38>, <0.38, 2.0, 0.38> } }
      max_gradient 2.2 texture { CactusTex } scale S translate Pos
    }
    sphere { Pos + <0, 2*S.y, 0>, 0.28*S.x texture { CactusTex } scale <1, 0.7, 1> }
  }
#end
Cactus(<-0.9, 0, 0.2>, <1, 0.9, 1>)
Cactus(<0.65, 0, -0.15>, <0.8, 0.65, 0.8>)
`,
  },
  {
    name: 'sourced-landscape',
    title: 'Procedural landscape (CC-BY-SA sample adaptation)',
    category: 'environment',
    tags: ['terrain', 'sky', 'fog', 'procedural', 'sample'],
    description: 'Layered hills and low fog reduce a classic landscape sample for quick render',
    author: 'POV-Ray sample scene authors',
    sourceUrl:
      'https://github.com/POV-Ray/povray/blob/master/distribution/scenes/advanced/landscape.pov',
    license: 'CC-BY-SA-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's landscape.pov sample.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <0, 1.3, -6> look_at <0, 1.0, 4> angle 50 }
sky_sphere { pigment { gradient y color_map { [0 color rgb <0.72, 0.86, 1>] [0.55 color rgb <0.22, 0.42, 0.75>] [1 color rgb <0.04, 0.08, 0.2>] } } }
light_source { <-4, 6, -3> color rgb <1, 0.88, 0.62> }
fog { distance 9 color rgb <0.62, 0.72, 0.78> fog_offset 0.1 fog_alt 1.2 }

#macro Ridge(Z, Amp, Col)
  height_field {
    function 80, 80 { 0.5 + 0.22*sin(x*10 + Z) + 0.12*sin(y*17 - Z) }
    smooth
    scale <8, Amp, 3>
    translate <-4, 0, Z>
    pigment { color rgb Col }
    finish { diffuse 0.75 }
  }
#end
plane { y, 0 pigment { color rgb <0.24, 0.24, 0.18> } normal { bumps 0.1 scale 0.45 } }
Ridge(1.2, 0.9, <0.18, 0.30, 0.16>)
Ridge(3.1, 1.2, <0.12, 0.22, 0.18>)
Ridge(5.3, 1.5, <0.10, 0.16, 0.20>)
`,
  },
  {
    name: 'sourced-woodbox',
    title: 'Wood box (CC-BY-SA sample adaptation)',
    category: 'texturing',
    tags: ['wood', 'box', 'grain', 'texture', 'sample'],
    description: 'A beveled wooden box highlights layered procedural grain',
    author: 'POV-Ray sample scene authors',
    sourceUrl:
      'https://github.com/POV-Ray/povray/blob/master/distribution/scenes/advanced/woodbox.pov',
    license: 'CC-BY-SA-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's woodbox.pov sample.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <4, 3, -5.8> look_at <0, 0.75, 0> angle 40 }
light_source { <-4, 6, -5> color rgb <1.1, 0.9, 0.7> area_light x*2, y*2, 3, 3 adaptive 1 }
plane { y, 0 pigment { color rgb <0.045, 0.04, 0.035> }
  finish { specular 0.35 roughness 0.02 reflection { 0.05, 0.18 } } }

#declare WoodTex = texture {
  pigment { wood color_map {
    [0 color rgb <0.33, 0.16, 0.055>] [0.45 color rgb <0.72, 0.38, 0.12>]
    [0.75 color rgb <0.24, 0.10, 0.035>] [1 color rgb <0.82, 0.55, 0.22>]
  } turbulence 0.25 scale <0.18, 0.9, 0.18> rotate y*12 }
  normal { wood 0.12 scale 0.25 }
  finish { diffuse 0.55 specular 0.45 roughness 0.018 }
}
difference {
  box { <-1.5, 0, -1.0>, <1.5, 1.1, 1.0> }
  box { <-1.22, 0.22, -0.72>, <1.22, 1.22, 0.72> }
  texture { WoodTex }
}
box { <-1.62, 1.08, -1.12>, <1.62, 1.28, 1.12> texture { WoodTex } rotate z*-5 translate <0.08, 0.08, 0> }
`,
  },
  {
    name: 'sourced-sunsethf',
    title: 'Sunset height field (CC-BY-SA sample adaptation)',
    category: 'environment',
    tags: ['height-field', 'sunset', 'terrain', 'water', 'sample'],
    description: 'A small height field catches orange sunset light beside reflective water',
    author: 'POV-Ray sample scene authors',
    sourceUrl:
      'https://github.com/POV-Ray/povray/blob/master/distribution/scenes/advanced/sunsethf.pov',
    license: 'CC-BY-SA-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's sunsethf.pov sample.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <0, 1.5, -6.5> look_at <0, 0.8, 2.5> angle 52 }
sky_sphere { pigment { gradient y color_map {
  [0 color rgb <1, 0.36, 0.08>] [0.35 color rgb <0.55, 0.12, 0.22>] [1 color rgb <0.02, 0.04, 0.14>]
} } }
light_source { <-3, 3, -4> color rgb <1.3, 0.55, 0.25> }
sphere { <1.4, 1.1, 7>, 0.55 pigment { color rgb <1, 0.62, 0.18> } finish { emission 1.5 diffuse 0 } no_shadow }
plane { y, 0 pigment { color rgb <0.06, 0.08, 0.10> }
  normal { waves 0.22 scale <1.0, 0.05, 1.8> } finish { diffuse 0.25 specular 0.65 roughness 0.01 reflection { 0.12, 0.38 } } }
height_field {
  function 64, 64 { 0.45 + 0.26*sin(x*11) + 0.16*sin(y*15) + 0.08*sin((x+y)*25) }
  smooth
  scale <4, 0.9, 3>
  translate <-2, 0, 0.7>
  pigment { color rgb <0.42, 0.24, 0.12> }
  finish { diffuse 0.75 specular 0.15 }
}
`,
  },
  {
    name: 'sourced-swirlbox',
    title: 'Swirl box (CC-BY-SA sample adaptation)',
    category: 'generative',
    tags: ['spiral', 'boxes', 'loop', 'color-map', 'sample'],
    description: 'Stacked boxes twist through a bright spiral color progression',
    author: 'POV-Ray sample scene authors',
    sourceUrl:
      'https://github.com/POV-Ray/povray/blob/master/distribution/scenes/advanced/swirlbox.pov',
    license: 'CC-BY-SA-3.0',
    animated: true,
    frames: 36,
    fps: 18,
    source: `// Adapted from POV-Ray's swirlbox.pov sample.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <0, 3.0, -6.5> look_at <0, 1.0, 0> angle 44 }
light_source { <-4, 7, -5> color rgb <1, 0.9, 0.7> }
light_source { <4, 3, -2> color rgb <0.25, 0.45, 1> shadowless }
plane { y, 0 pigment { color rgb <0.025, 0.026, 0.033> } finish { reflection { 0.08, 0.28 } specular 0.4 roughness 0.012 } }

#for (I, 0, 23)
  #declare T = I/23;
  box { <-0.85, -0.04, -0.85>, <0.85, 0.04, 0.85>
    rotate y*(I*17 + clock*360)
    translate <0, 0.14 + I*0.075, 0>
    pigment { color rgb <0.15 + 0.75*T, 0.75 - 0.4*T, 1 - 0.65*T> }
    finish { specular 0.35 roughness 0.02 }
  }
#end
`,
  },
  {
    name: 'sourced-mediasky',
    title: 'Media sky (CC-BY-SA sample adaptation)',
    category: 'environment',
    tags: ['media', 'sky', 'clouds', 'atmosphere', 'sample'],
    description: 'Soft translucent cloud slabs make a fast atmospheric sky study',
    author: 'POV-Ray sample scene authors',
    sourceUrl:
      'https://github.com/POV-Ray/povray/blob/master/distribution/scenes/advanced/mediasky.pov',
    license: 'CC-BY-SA-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's mediasky.pov sample.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <0, 1.6, -5.5> look_at <0, 1.6, 2> angle 50 }
sky_sphere { pigment { gradient y color_map { [0 color rgb <0.55, 0.75, 1>] [1 color rgb <0.08, 0.18, 0.42>] } } }
light_source { <-4, 5, -3> color rgb <1.1, 0.95, 0.78> }
plane { y, 0 pigment { color rgb <0.18, 0.24, 0.22> } normal { bumps 0.08 scale 0.9 } }

#for (I, 0, 6)
  box { <-4, 1.2 + I*0.22, 2 + I*0.35>, <4, 1.55 + I*0.22, 2.04 + I*0.35>
    pigment { bozo color_map { [0 color rgbt <1, 1, 1, 0.95>] [0.55 color rgbt <1, 1, 1, 0.55>] [1 color rgbt <1, 1, 1, 1>] } scale 0.9 turbulence 0.8 }
    finish { emission 0.2 diffuse 0.25 }
    no_shadow
  }
#end
`,
  },
  {
    name: 'sourced-mtmand',
    title: 'Mandel mountain (CC-BY-SA sample adaptation)',
    category: 'implicit',
    tags: ['fractal', 'mandel', 'terrain', 'height-field', 'sample'],
    description: 'A compact fractal terrain echoes the classic Mandel mountain sample',
    author: 'POV-Ray sample scene authors',
    sourceUrl:
      'https://github.com/POV-Ray/povray/blob/master/distribution/scenes/advanced/mtmand.pov',
    license: 'CC-BY-SA-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's mtmand.pov sample.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <3.5, 2.5, -5.5> look_at <0, 0.55, 0.6> angle 42 }
light_source { <-4, 6, -4> color rgb <1, 0.9, 0.72> }
sky_sphere { pigment { gradient y color_map { [0 color rgb <0.7, 0.8, 0.95>] [1 color rgb <0.05, 0.08, 0.18>] } } }
height_field {
  function 96, 96 { pattern { mandel 48 exponent 2 scale 1.6 translate <-0.75, -0.1, 0> } }
  smooth
  scale <4, 1.4, 4>
  translate <-2, 0, -1>
  pigment { gradient y color_map { [0 color rgb <0.12, 0.16, 0.14>] [0.55 color rgb <0.35, 0.30, 0.22>] [1 color rgb <0.86, 0.82, 0.72>] } }
  finish { diffuse 0.78 specular 0.18 }
}
plane { y, -0.02 pigment { color rgb <0.06, 0.07, 0.08> } }
`,
  },
  {
    name: 'sourced-sombrero',
    title: 'Sombrero surface (CC-BY-SA sample adaptation)',
    category: 'implicit',
    tags: ['function', 'surface', 'math', 'rings', 'sample'],
    description: 'A sine-over-radius surface forms a polished sombrero ripple',
    author: 'POV-Ray sample scene authors',
    sourceUrl:
      'https://github.com/POV-Ray/povray/blob/master/distribution/scenes/advanced/sombrero.pov',
    license: 'CC-BY-SA-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's sombrero.pov sample.
#version 3.8;
global_settings { assumed_gamma 1.0 }
#include "functions.inc"

camera { location <4, 2.7, -5.5> look_at <0, 0.25, 0> angle 42 }
light_source { <-4, 6, -5> color rgb <1, 0.9, 0.75> area_light x*2, y*2, 3, 3 adaptive 1 }
plane { y, -0.15 pigment { color rgb <0.025, 0.025, 0.035> } finish { reflection { 0.08, 0.24 } specular 0.35 roughness 0.014 } }
isosurface {
  function { y - (sin(7*sqrt(x*x+z*z))/(1 + 5*sqrt(x*x+z*z))) }
  contained_by { box { <-2.2, -0.45, -2.2>, <2.2, 1.1, 2.2> } }
  max_gradient 5
  pigment { radial color_map { [0 color rgb <0.95, 0.72, 0.18>] [0.5 color rgb <0.25, 0.65, 0.95>] [1 color rgb <0.08, 0.12, 0.35>] } frequency 6 }
  finish { specular 0.55 roughness 0.018 }
}
`,
  },
  {
    name: 'sourced-lamppost',
    title: 'Lamppost (CC-BY-SA sample adaptation)',
    category: 'lighting',
    tags: ['lamp', 'emission', 'night', 'shadows', 'sample'],
    description: 'A small street lamp casts warm light onto a quiet night pavement',
    author: 'POV-Ray sample scene authors',
    sourceUrl:
      'https://github.com/POV-Ray/povray/blob/master/distribution/scenes/advanced/lamppost.pov',
    license: 'CC-BY-SA-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's lamppost.pov sample.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <3, 2.4, -6> look_at <0, 1.2, 0> angle 42 }
background { color rgb <0.01, 0.012, 0.03> }
light_source { <0, 2.7, 0> color rgb <1.2, 0.78, 0.35> fade_distance 3 fade_power 2 area_light x*0.5, z*0.5, 3, 3 adaptive 1 }
light_source { <-4, 5, -4> color rgb <0.18, 0.25, 0.55> shadowless }
plane { y, 0 pigment { color rgb <0.035, 0.035, 0.04> }
  normal { bumps 0.12 scale 0.35 } finish { diffuse 0.42 specular 0.5 roughness 0.018 reflection { 0.08, 0.24 } } }

#declare Metal = texture { pigment { color rgb <0.08, 0.07, 0.06> } finish { metallic specular 0.65 roughness 0.02 } }
cylinder { <0, 0, 0>, <0, 2.45, 0>, 0.065 texture { Metal } }
sphere { <0, 2.62, 0>, 0.26 pigment { color rgbf <1, 0.78, 0.35, 0.25> } finish { emission 0.85 diffuse 0.15 specular 0.4 } }
cone { <0, 2.85, 0>, 0.38, <0, 2.62, 0>, 0.25 texture { Metal } }
torus { 0.3, 0.025 translate y*2.55 texture { Metal } }
`,
  },
  {
    name: 'sourced-optics',
    title: 'Optics bench (CC-BY-SA sample adaptation)',
    category: 'optics',
    tags: ['lens', 'glass', 'refraction', 'bench', 'sample'],
    description: 'A prism and lens bend colored beams across a dark optics bench',
    author: 'POV-Ray sample scene authors',
    sourceUrl:
      'https://github.com/POV-Ray/povray/blob/master/distribution/scenes/advanced/optics.pov',
    license: 'CC-BY-SA-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's optics.pov sample.
#version 3.8;
global_settings { assumed_gamma 1.0 max_trace_level 8 }

camera { location <3.4, 2.1, -5.8> look_at <0, 0.75, 0> angle 40 }
light_source { <-4, 5, -4> color rgb <0.7, 0.8, 1> }
plane { y, 0 pigment { color rgb <0.018, 0.02, 0.026> } finish { specular 0.45 roughness 0.012 reflection { 0.08, 0.28 } } }

#declare Glass = texture { pigment { color rgbf <0.8, 0.95, 1, 0.72> }
  finish { diffuse 0.03 specular 0.9 roughness 0.004 reflection 0.08 } }
box { <-1.1, 0.28, -0.18>, <-0.1, 1.25, 0.18> rotate z*18 texture { Glass } interior { ior 1.55 } }
sphere { <0.85, 0.78, 0>, 0.55 scale <0.35, 1, 1> texture { Glass } interior { ior 1.47 } }
cylinder { <-2.6, 0.8, 0>, <-1.15, 0.8, 0>, 0.025 pigment { color rgb <1, 0.08, 0.05> } finish { emission 0.7 diffuse 0 } no_shadow }
cylinder { <-1.0, 0.78, 0>, <1.45, 1.05, 0>, 0.018 pigment { color rgb <1, 0.15, 0.05> } finish { emission 0.55 diffuse 0 } no_shadow }
cylinder { <-1.0, 0.78, 0>, <1.45, 0.55, 0>, 0.018 pigment { color rgb <0.1, 0.45, 1> } finish { emission 0.55 diffuse 0 } no_shadow }
cylinder { <-1.0, 0.78, 0>, <1.45, 0.80, 0>, 0.018 pigment { color rgb <0.2, 1, 0.2> } finish { emission 0.5 diffuse 0 } no_shadow }
`,
  },
  {
    name: 'sourced-quilt',
    title: 'Quilted tiles (CC-BY-SA sample adaptation)',
    category: 'texturing',
    tags: ['quilted', 'normal', 'tiles', 'texture', 'sample'],
    description: 'Quilted normals and color bands turn simple tiles into padded fabric',
    author: 'POV-Ray sample scene authors',
    sourceUrl:
      'https://github.com/POV-Ray/povray/blob/master/distribution/scenes/advanced/quilt1.pov',
    license: 'CC-BY-SA-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's quilt1.pov sample.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <0, 4.2, -5.0> look_at <0, 0, 0> angle 42 }
light_source { <-3, 6, -4> color rgb <1, 0.92, 0.8> area_light x*2, y*2, 3, 3 adaptive 1 }
plane { y, 0 pigment { color rgb <0.02, 0.02, 0.025> } }
#for (X, -3, 3)
  #for (Z, -2, 2)
    box { <-0.42, 0, -0.42>, <0.42, 0.08, 0.42>
      translate <X*0.88, 0, Z*0.88>
      pigment { color rgb <0.2 + 0.09*(X+3), 0.25 + 0.1*(Z+2), 0.75 - 0.05*X> }
      normal { quilted 0.55 control0 0.8 control1 1.2 scale 0.22 }
      finish { diffuse 0.65 specular 0.25 roughness 0.04 }
    }
  #end
#end
`,
  },
  {
    name: 'sourced-wallstucco',
    title: 'Stucco wall (CC-BY-SA sample adaptation)',
    category: 'texturing',
    tags: ['stucco', 'normal', 'wall', 'lighting', 'sample'],
    description: 'A raking light reveals rough procedural stucco on a simple wall',
    author: 'POV-Ray sample scene authors',
    sourceUrl:
      'https://github.com/POV-Ray/povray/blob/master/distribution/scenes/advanced/wallstucco.pov',
    license: 'CC-BY-SA-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's wallstucco.pov sample.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <0, 1.4, -5> look_at <0, 1.2, 0> angle 40 }
light_source { <-3.5, 2.4, -3> color rgb <1.1, 0.88, 0.62> }
light_source { <4, 5, -4> color rgb <0.18, 0.24, 0.45> shadowless }
box { <-3, 0, 0>, <3, 2.7, 0.18>
  pigment { color rgb <0.72, 0.68, 0.58> }
  normal { wrinkles 0.55 scale 0.18 turbulence 0.65 }
  finish { diffuse 0.8 specular 0.18 roughness 0.08 }
}
box { <-2.8, 0.15, -0.05>, <-1.65, 1.15, 0.0> pigment { color rgb <0.12, 0.08, 0.05> } finish { diffuse 0.55 } }
box { <1.2, 0.35, -0.05>, <2.25, 1.75, 0.0> pigment { color rgb <0.05, 0.08, 0.13> } finish { specular 0.25 } }
plane { y, 0 pigment { color rgb <0.12, 0.11, 0.10> } }
`,
  },
  {
    name: 'sourced-borromean-rings',
    title: 'Borromean rings (GPL figure adaptation)',
    category: 'modeling',
    tags: ['torus', 'rings', 'math', 'topology', 'gpl'],
    description: 'Three interlocked tori reproduce a classic Borromean-ring figure',
    author: 'Ryan Maguire / Jim Belk',
    sourceUrl: 'https://github.com/ryanmaguire/povray_figures/blob/main/src/borromean_rings.pov',
    license: 'GPL-3.0-or-later',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from ryanmaguire/povray_figures borromean_rings.pov.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <0, 1.4, -5> look_at <0, 0.15, 0> angle 36 }
light_source { <0, 5, -5> color rgb <1, 0.95, 0.85> area_light x*2, y*2, 3, 3 adaptive 1 }
plane { y, -0.65 pigment { color rgb <0.92, 0.92, 0.9> } finish { diffuse 0.65 specular 0.18 } }
#declare RingFinish = finish { diffuse 0.78 specular 0.45 roughness 0.02 }
torus { 0.85, 0.075 rotate x*90 translate <0.52, 0.05, 0> pigment { color rgb <0.0, 0.75, 0.08> } finish { RingFinish } }
torus { 0.85, 0.075 rotate x*90 rotate z*120 translate <-0.26, 0.50, 0> pigment { color rgb <0.9, 0.02, 0.04> } finish { RingFinish } }
torus { 0.85, 0.075 rotate x*90 rotate z*-120 translate <-0.26, -0.40, 0> pigment { color rgb <0.0, 0.20, 1.0> } finish { RingFinish } }
// Short front overlays sell the over-under crossings without heavy CSG.
#declare Cut = cylinder { <0, 0, -2>, <0, 0, 2>, 0.18 }
intersection { torus { 0.85, 0.078 rotate x*90 translate <0.52, 0.05, -0.03> } object { Cut translate <0.1, 0.8, 0> } pigment { color rgb <0, 0.75, 0.08> } finish { RingFinish } }
intersection { torus { 0.85, 0.078 rotate x*90 rotate z*120 translate <-0.26, 0.50, -0.04> } object { Cut translate <-0.72, -0.05, 0> } pigment { color rgb <0.9, 0.02, 0.04> } finish { RingFinish } }
`,
  },
  {
    name: 'sourced-figure-eight-knot',
    title: 'Figure-eight knot (GPL figure adaptation)',
    category: 'generative',
    tags: ['knot', 'sphere-sweep', 'math', 'parametric', 'gpl'],
    description: 'A sphere-sweep tube traces a compact figure-eight knot',
    author: 'Ryan Maguire',
    sourceUrl: 'https://github.com/ryanmaguire/povray_figures/blob/main/src/figure_eight_knot.pov',
    license: 'GPL-3.0-or-later',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from ryanmaguire/povray_figures figure_eight_knot.pov.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <0, 2.2, -6> look_at <0, 0, 0> angle 38 }
light_source { <-4, 6, -4> color rgb <1, 0.9, 0.75> area_light x*2, y*2, 3, 3 adaptive 1 }
plane { y, -1.25 pigment { color rgb <0.025, 0.025, 0.032> } finish { reflection { 0.08, 0.22 } specular 0.35 roughness 0.02 } }

sphere_sweep {
  cubic_spline 73,
  #for (I, 0, 72)
    #declare T = 2*pi*I/72;
    <(2 + cos(2*T))*cos(3*T)/2.7, sin(2*T)/1.35, (2 + cos(2*T))*sin(3*T)/2.7>, 0.055
  #end
  tolerance 0.001
  pigment { color rgb <0.92, 0.35, 0.08> }
  finish { specular 0.65 roughness 0.015 }
}
`,
  },
  {
    name: 'sourced-endless-knot',
    title: 'Endless knot (GPL figure adaptation)',
    category: 'motion',
    tags: ['knot', 'animation', 'torus', 'math', 'gpl'],
    description: 'A rotating endless-knot curve keeps the GPL topology figure lightweight',
    author: 'Ryan Maguire',
    sourceUrl:
      'https://github.com/ryanmaguire/povray_figures/blob/main/src/endless_knot_no_shadow.pov',
    license: 'GPL-3.0-or-later',
    animated: true,
    frames: 48,
    fps: 24,
    source: `// Adapted from ryanmaguire/povray_figures endless_knot_no_shadow.pov.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <0, 2.8, -6.4> look_at <0, 0, 0> angle 38 }
light_source { <-4, 6, -5> color rgb <1, 0.95, 0.82> }
light_source { <4, 3, -2> color rgb <0.2, 0.35, 0.8> shadowless }
background { color rgb <0.01, 0.012, 0.02> }

union {
  sphere_sweep {
    cubic_spline 97,
    #for (I, 0, 96)
      #declare T = 2*pi*I/96;
      <1.25*sin(2*T), 0.65*sin(3*T), 1.25*cos(2*T)> + <0.26*sin(5*T), 0, 0.26*cos(5*T)>, 0.05
    #end
    tolerance 0.001
  }
  pigment { color rgb <0.15, 0.75, 1> }
  finish { emission 0.1 specular 0.65 roughness 0.018 }
  rotate y*(clock*360)
}
`,
  },
  {
    name: 'sourced-alexander-horned',
    title: 'Horned sphere (GPL figure adaptation)',
    category: 'implicit',
    tags: ['recursive', 'torus', 'sphere', 'math', 'gpl'],
    description: 'Nested paired tori suggest the Alexander horned-sphere construction',
    author: 'Ryan Maguire',
    sourceUrl:
      'https://github.com/ryanmaguire/povray_figures/blob/main/src/alexander_horned_sphere.pov',
    license: 'GPL-3.0-or-later',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from ryanmaguire/povray_figures alexander_horned_sphere.pov.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <0, 2.1, -6> look_at <0, 0.2, 0> angle 36 }
light_source { <-4, 6, -4> color rgb <1, 0.9, 0.78> area_light x*2, y*2, 3, 3 adaptive 1 }
plane { y, -1.1 pigment { color rgb <0.03, 0.03, 0.036> } finish { reflection { 0.05, 0.18 } specular 0.3 } }
#declare HornTex = texture { pigment { color rgb <0.78, 0.88, 1> } finish { specular 0.7 roughness 0.012 reflection 0.08 } }
sphere { <0, 0, 0>, 0.55 texture { HornTex } }
#for (L, 0, 4)
  #declare R = 0.78/(L+1);
  #declare D = 0.52 + L*0.28;
  torus { R, 0.045/(1 + L*0.15) rotate x*90 translate <-D, 0.12*L, 0> texture { HornTex } }
  torus { R, 0.045/(1 + L*0.15) rotate x*90 translate < D, 0.12*L, 0> texture { HornTex } }
  torus { R*0.62, 0.035/(1 + L*0.18) rotate z*90 translate <0, 0.12*L, -D> texture { HornTex } }
#end
`,
  },
  {
    name: 'sourced-diffract',
    title: 'Diffraction grating (CC-BY-SA sample adaptation)',
    category: 'optics',
    tags: ['diffraction', 'grating', 'spectrum', 'light', 'sample'],
    description: 'Thin glowing spectrum bands pass through a compact diffraction grating',
    author: 'POV-Ray sample scene authors',
    sourceUrl:
      'https://github.com/POV-Ray/povray/blob/master/distribution/scenes/advanced/diffract.pov',
    license: 'CC-BY-SA-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's diffract.pov sample.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <0, 1.6, -5.2> look_at <0, 0.9, 0> angle 42 }
background { color rgb <0.005, 0.006, 0.012> }
light_source { <-3, 4, -3> color rgb <0.45, 0.55, 0.8> }
plane { y, 0 pigment { color rgb <0.015, 0.016, 0.022> } finish { reflection { 0.08, 0.25 } specular 0.4 roughness 0.012 } }

#for (I, -6, 6)
  cylinder { <I*0.06, 0.25, -0.12>, <I*0.06, 1.8, -0.12>, 0.008
    pigment { color rgb <0.7, 0.78, 0.9> } finish { specular 0.55 roughness 0.02 } }
#end
cylinder { <-2.4, 1.0, -0.35>, <-0.42, 1.0, -0.12>, 0.025 pigment { color rgb <1, 1, 1> } finish { emission 0.7 diffuse 0 } no_shadow }
#for (I, 0, 5)
  #declare Y = 0.68 + I*0.12;
  #switch (I)
    #case (0) #declare Col = <1, 0.05, 0.02>; #break
    #case (1) #declare Col = <1, 0.45, 0.02>; #break
    #case (2) #declare Col = <1, 0.95, 0.05>; #break
    #case (3) #declare Col = <0.12, 1, 0.15>; #break
    #case (4) #declare Col = <0.1, 0.45, 1>; #break
    #else #declare Col = <0.7, 0.16, 1>;
  #end
  cylinder { <0.42, 1.0, -0.12>, <2.35, Y, 0.2>, 0.017
    pigment { color rgb Col } finish { emission 0.55 diffuse 0 } no_shadow }
#end
`,
  },
  {
    name: 'sourced-pawns',
    title: 'Pawns row (CC-BY-SA sample adaptation)',
    category: 'modeling',
    tags: ['pawns', 'lathe', 'chess', 'depth', 'sample'],
    description: 'A staggered row of glossy lathe-modeled pawns recedes into soft light',
    author: 'Douglas Otwell',
    sourceUrl: officialSceneUrl('advanced/pawns.pov'),
    license: 'CC-BY-SA-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's pawns.pov sample by Douglas Otwell.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <3.8, 2.2, -6.2> look_at <0.2, 0.75, 0.1> angle 38 }
light_source { <-4, 6, -4> color rgb <1.15, 1.05, 0.88> area_light x*2, y*2, 3, 3 adaptive 1 }
light_source { <4, 2, -3> color rgb <0.25, 0.35, 0.55> shadowless }
plane { y, 0 pigment { checker color rgb <0.06,0.065,0.075>, color rgb <0.75,0.72,0.66> scale 0.55 }
  finish { diffuse 0.45 specular 0.35 reflection { 0.04, 0.16 } } }

#declare PawnTex = texture { pigment { color rgb <0.92, 0.82, 0.58> } finish { specular 0.7 roughness 0.015 reflection 0.1 } }
#macro Pawn(Pos, S)
  union {
    sphere { <0, 1.05, 0>, 0.22 }
    cone { <0, 0.3, 0>, 0.28, <0, 0.95, 0>, 0.12 }
    torus { 0.22, 0.035 translate y*0.28 }
    cylinder { <0,0,0>, <0,0.12,0>, 0.32 }
    texture { PawnTex }
    scale S translate Pos
  }
#end
#for (I, -3, 3)
  Pawn(<I*0.58, 0, 0.22*I>, 0.78 + 0.03*I)
#end
`,
  },
  {
    name: 'sourced-biscuit',
    title: 'Biscuit material study (CC-BY-SA sample adaptation)',
    category: 'texturing',
    tags: ['cookie', 'texture', 'crackle', 'crumb', 'sample'],
    description: 'Procedural crumbs and chocolate chips show layered material noise',
    author: 'Fabien Mosen',
    sourceUrl: officialSceneUrl('advanced/biscuit.pov'),
    license: 'CC-BY-SA-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's biscuit.pov sample by Fabien Mosen.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <0, 3.2, -5.0> look_at <0, 0.15, 0> angle 42 }
light_source { <-3, 5, -4> color rgb <1.1, 0.95, 0.72> area_light x*2, y*2, 3, 3 adaptive 1 }
plane { y, -0.08 pigment { color rgb <0.045, 0.04, 0.036> } finish { specular 0.25 roughness 0.03 } }

#declare BiscuitTex = texture {
  pigment { bozo color_map { [0 rgb <0.72,0.48,0.24>] [0.5 rgb <0.95,0.74,0.42>] [1 rgb <0.45,0.25,0.12>] } scale 0.28 turbulence 0.8 }
  normal { bumps 0.12 scale 0.08 }
  finish { diffuse 0.82 specular 0.12 roughness 0.08 }
}
cylinder { <0,-0.03,0>, <0,0.10,0>, 1.55 texture { BiscuitTex } scale <1.15,1,0.82> }
#for (I, 0, 27)
  #declare A = I*137.5;
  #declare R = 0.25 + 1.12*mod(I*0.37, 1);
  sphere { <R*cos(radians(A))*1.15, 0.14, R*sin(radians(A))*0.82>, 0.09
    pigment { color rgb <0.12,0.06,0.03> } finish { specular 0.18 roughness 0.04 } }
#end
`,
  },
  {
    name: 'sourced-bwstripe',
    title: 'Black-white stripe illusion (CC-BY-SA sample adaptation)',
    category: 'generative',
    tags: ['stripe', 'moire', 'pattern', 'optical', 'sample'],
    description: 'Offset striped slabs create a simple high-contrast optical rhythm',
    author: 'Rune S. Johansen',
    sourceUrl: officialSceneUrl('advanced/bwstripe.pov'),
    license: 'CC-BY-SA-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's bwstripe.pov sample by Rune S. Johansen.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <0, 2.4, -6> look_at <0, 0.5, 0> angle 42 }
light_source { <-3, 5, -4> color rgb 1.2 }
plane { y, -0.05 pigment { color rgb <0.04,0.045,0.05> } finish { reflection { 0.03, 0.12 } } }

#macro StripeWall(Z, Tilt)
  union {
    #for (I, -12, 12)
      box { <I*0.18, 0, -0.02>, <I*0.18 + 0.09, 1.9, 0.02>
        pigment { color rgb ((mod(I,2)=0) ? <1,1,1> : <0,0,0>) } }
    #end
    rotate y*Tilt translate <0,0,Z>
  }
#end
object { StripeWall(0.15, -9) }
object { StripeWall(0.55, 9) translate y*0.08 }
`,
  },
  {
    name: 'sourced-mist',
    title: 'Mist valley (CC-BY-SA sample adaptation)',
    category: 'environment',
    tags: ['mist', 'fog', 'terrain', 'atmosphere', 'sample'],
    description: 'Layered ridges fade into a compact ground-fog atmosphere study',
    author: 'POV-Ray sample scene authors',
    sourceUrl: officialSceneUrl('advanced/mist.pov'),
    license: 'CC-BY-SA-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's mist.pov sample.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <0, 1.2, -6.2> look_at <0, 0.9, 2.4> angle 48 }
sky_sphere { pigment { gradient y color_map { [0 rgb <0.78,0.84,0.9>] [1 rgb <0.18,0.27,0.42>] } } }
light_source { <-4, 6, -2> color rgb <1,0.86,0.65> }
fog { distance 5 color rgb <0.72,0.78,0.82> fog_type 2 fog_offset 0.05 fog_alt 0.7 }
plane { y, 0 pigment { color rgb <0.19,0.24,0.2> } normal { bumps 0.16 scale 0.7 } }
#macro Ridge(Z, H, C)
  height_field { function 64, 64 { 0.5 + 0.18*sin(x*9+Z) + 0.12*sin(y*15-Z) } smooth
    scale <7,H,2.5> translate <-3.5,0,Z> pigment { color rgb C } finish { diffuse 0.8 } }
#end
Ridge(1.0, 0.9, <0.18,0.30,0.20>)
Ridge(2.8, 1.2, <0.12,0.22,0.22>)
Ridge(4.8, 1.5, <0.08,0.13,0.20>)
`,
  },
  {
    name: 'sourced-fisheye',
    title: 'Fisheye camera room (CC-BY sample adaptation)',
    category: 'camera',
    tags: ['camera', 'fisheye', 'lens', 'grid', 'sample'],
    description: 'A fisheye view bends a gridded room into a compact lens demo',
    author: 'Fabien Mosen / Friedrich A. Lohmueller',
    sourceUrl: officialSceneUrl('camera/fisheye.pov'),
    license: 'CC-BY-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's camera/fisheye.pov sample by Fabien Mosen.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { fisheye location <0, 1.15, -3.4> look_at <0, 0.85, 0.2> angle 150 }
light_source { <0, 3.8, -2.5> color rgb 1.1 }
plane { y, 0 pigment { checker color rgb <0.05,0.05,0.055>, color rgb <0.82,0.82,0.78> scale 0.45 } }
plane { z, 2.4 pigment { checker color rgb <0.16,0.22,0.32>, color rgb <0.5,0.62,0.78> scale 0.5 } finish { diffuse 0.75 } }
#for (X, -2, 2)
  cylinder { <X,0,0>, <X,1.8,0>, 0.06 pigment { color rgb <1,0.72,0.2> } finish { specular 0.4 } }
#end
sphere { <0,0.45,0.4>, 0.45 pigment { color rgb <0.8,0.04,0.08> } finish { specular 0.55 reflection 0.08 } }
`,
  },
  {
    name: 'sourced-panoramic-camera',
    title: 'Panoramic camera ring (CC-BY sample adaptation)',
    category: 'camera',
    tags: ['camera', 'panoramic', 'ring', 'lens', 'sample'],
    description: 'Repeated pillars wrap around a panoramic camera demonstration',
    author: 'Fabien Mosen / Friedrich A. Lohmueller',
    sourceUrl: officialSceneUrl('camera/panoramic.pov'),
    license: 'CC-BY-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's camera/panoramic.pov sample by Fabien Mosen.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { panoramic location <0, 1.25, 0> look_at <0, 1.2, 1> angle 120 }
light_source { <0, 5, 0> color rgb 1.15 }
plane { y, 0 pigment { color rgb <0.035,0.04,0.045> } finish { reflection { 0.05, 0.18 } } }
#for (I, 0, 15)
  #declare A = radians(I*360/16);
  cylinder { <2.2*cos(A),0,2.2*sin(A)>, <2.2*cos(A),1.8,2.2*sin(A)>, 0.08
    pigment { color rgb <0.25+0.04*I,0.55,0.85-0.03*I> } finish { specular 0.35 } }
#end
torus { 1.25, 0.035 pigment { color rgb <1,0.8,0.24> } finish { emission 0.2 specular 0.4 } }
`,
  },
  {
    name: 'sourced-magglass',
    title: 'Magnifying glass (CC-BY sample adaptation)',
    category: 'optics',
    tags: ['magnifier', 'glass', 'refraction', 'checker', 'sample'],
    description: 'A simple lens magnifies a checker pattern through refraction',
    author: 'POV-Ray sample scene authors',
    sourceUrl: officialSceneUrl('interior/magglass.pov'),
    license: 'CC-BY-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's interior/magglass.pov sample.
#version 3.8;
global_settings { assumed_gamma 1.0 max_trace_level 8 }

camera { location <0, 2.0, -5> look_at <0, 0.55, 0> angle 40 }
light_source { <-3, 5, -4> color rgb <1.1,1.0,0.85> area_light x*2, y*2, 3, 3 adaptive 1 }
plane { y, 0 pigment { checker color rgb <0.06,0.06,0.07>, color rgb <0.86,0.84,0.76> scale 0.25 }
  finish { specular 0.25 } }
torus { 0.78, 0.045 rotate x*90 translate <0,0.72,0> pigment { color rgb <0.75,0.78,0.82> } finish { metallic specular 0.7 reflection 0.15 } }
sphere { <0,0.72,0>, 0.72 scale <1,1,0.16>
  pigment { color rgbf <0.92,0.98,1,0.86> }
  finish { diffuse 0.02 specular 0.9 reflection { 0.04,0.22 } }
  interior { ior 1.52 } }
cylinder { <0.62,0.22,0>, <1.55,-0.6,0>, 0.065 pigment { color rgb <0.22,0.13,0.05> } finish { specular 0.35 } }
`,
  },
  {
    name: 'sourced-crystal',
    title: 'Crystal cluster (CC-BY sample adaptation)',
    category: 'optics',
    tags: ['crystal', 'refraction', 'glass', 'prism', 'sample'],
    description: 'Low-poly refractive crystals catch colored highlights on a dark floor',
    author: 'Dan Farmer',
    sourceUrl: officialSceneUrl('interior/crystal.pov'),
    license: 'CC-BY-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's interior/crystal.pov sample by Dan Farmer.
#version 3.8;
global_settings { assumed_gamma 1.0 max_trace_level 10 }

camera { location <3.2, 2.0, -5.0> look_at <0, 0.65, 0> angle 38 }
light_source { <-4, 5, -4> color rgb <1,0.9,0.75> }
light_source { <3, 2, -3> color rgb <0.25,0.45,0.9> shadowless }
plane { y, 0 pigment { color rgb <0.02,0.022,0.028> } finish { reflection { 0.08,0.28 } specular 0.45 roughness 0.01 } }
#declare CrystalTex = texture { pigment { color rgbf <0.76,0.93,1,0.78> } finish { diffuse 0.02 specular 1 roughness 0.003 reflection { 0.06,0.28 } } }
#macro Crystal(Pos, S, Rot)
  cone { <0,0,0>, 0.32, <0,1.4,0>, 0.08 rotate Rot scale S translate Pos texture { CrystalTex } interior { ior 1.55 } }
#end
Crystal(<-0.45,0,0>, <1,1,1>, <0,0,-8>)
Crystal(<0.15,0,-0.15>, <0.8,0.85,0.8>, <0,20,10>)
Crystal(<0.55,0,0.2>, <0.7,0.7,0.7>, <0,-18,-7>)
`,
  },
  {
    name: 'sourced-soft-light',
    title: 'Soft light comparison (CC-BY sample adaptation)',
    category: 'lighting',
    tags: ['area-light', 'shadow', 'sphere', 'softness', 'sample'],
    description: 'Area-light shadows soften across a row of matte spheres',
    author: 'Steve Anger',
    sourceUrl: officialSceneUrl('lights/soft.pov'),
    license: 'CC-BY-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's lights/soft.pov sample by Steve Anger.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <0, 2.6, -6> look_at <0, 0.65, 0> angle 42 }
light_source { <-3, 5, -4> color rgb 1.15 area_light x*3, z*3, 4, 4 adaptive 1 jitter }
plane { y, 0 pigment { color rgb <0.72,0.74,0.76> } finish { diffuse 0.65 specular 0.12 } }
plane { z, 2.2 pigment { color rgb <0.16,0.18,0.22> } finish { diffuse 0.8 } }
#for (I, -2, 2)
  sphere { <I*0.7,0.45,0>, 0.42 pigment { color rgb <0.25+0.12*I,0.42,0.78-0.08*I> } finish { diffuse 0.7 specular 0.25 } }
#end
`,
  },
  {
    name: 'sourced-laser',
    title: 'Laser beam (CC-BY sample adaptation)',
    category: 'lighting',
    tags: ['laser', 'beam', 'emission', 'optics', 'sample'],
    description: 'A glowing red beam crosses mirrors in a tiny dark optical bench',
    author: 'Dan Farmer',
    sourceUrl: officialSceneUrl('lights/laser.pov'),
    license: 'CC-BY-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's lights/laser.pov sample by Dan Farmer.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <0, 2.0, -5.2> look_at <0, 0.75, 0> angle 40 }
background { color rgb <0.004,0.005,0.008> }
light_source { <-2, 4, -3> color rgb <0.25,0.28,0.35> }
plane { y, 0 pigment { color rgb <0.014,0.015,0.018> } finish { reflection { 0.05,0.2 } } }
cylinder { <-2.2,0.75,-0.25>, <2.0,0.75,0.1>, 0.025 pigment { color rgb <1,0.04,0.02> } finish { emission 0.7 diffuse 0 } no_shadow }
box { <-2.5,0.55,-0.45>, <-2.15,0.95,-0.05> pigment { color rgb <0.45,0.02,0.02> } finish { emission 0.2 specular 0.4 } }
#for (I, -1, 1)
  box { <-0.08,0.2,-0.4>, <0.08,1.2,0.4> rotate y*(35+I*25) translate <I*1.0,0,0>
    pigment { color rgb <0.75,0.82,0.95> } finish { reflection { 0.35,0.85 } specular 0.9 roughness 0.004 } }
#end
`,
  },
  {
    name: 'sourced-bezier',
    title: 'Bezier patch sail (CC-BY sample adaptation)',
    category: 'modeling',
    tags: ['bezier', 'patch', 'surface', 'control', 'sample'],
    description: 'A bicubic patch bends like a small glossy sail under studio light',
    author: 'Alexander Enzmann',
    sourceUrl: officialSceneUrl('objects/bezier.pov'),
    license: 'CC-BY-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's objects/bezier.pov sample by Alexander Enzmann.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <3.0,2.2,-4.6> look_at <0,0.65,0> angle 36 }
light_source { <-3,5,-4> color rgb <1.1,1.0,0.85> area_light x*2, y*2, 3, 3 adaptive 1 }
plane { y, -0.05 pigment { color rgb <0.04,0.045,0.052> } finish { reflection { 0.04,0.16 } specular 0.25 } }
bicubic_patch {
  type 1 flatness 0.01 u_steps 4 v_steps 4
  <-1,0,0>, <-0.3,0.8,0.2>, <0.35,0.2,-0.25>, <1,0.7,0>
  <-1,0.35,0.6>, <-0.3,1.2,0.35>, <0.35,0.55,-0.1>, <1,0.9,0.45>
  <-1,0.8,0.2>, <-0.3,1.55,0.1>, <0.35,0.85,0.25>, <1,1.25,0.1>
  <-1,1.1,-0.15>, <-0.3,1.8,0.3>, <0.35,1.2,0.0>, <1,1.55,-0.2>
  pigment { color rgb <0.1,0.58,0.92> } finish { specular 0.75 roughness 0.01 reflection 0.08 }
}
`,
  },
  {
    name: 'sourced-quartic-helix',
    title: 'Quartic helix (CC-BY sample adaptation)',
    category: 'implicit',
    tags: ['quartic', 'helix', 'math', 'surface', 'sample'],
    description: 'A compact quartic-inspired helix wraps around a polished axis',
    author: 'Alexander Enzmann',
    sourceUrl: officialSceneUrl('objects/quartic/helix.pov'),
    license: 'CC-BY-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's objects/quartic/helix.pov sample by Alexander Enzmann.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <3.2, 2.2, -5> look_at <0, 0.8, 0> angle 36 }
light_source { <-4, 5, -4> color rgb <1.05,0.95,0.8> area_light x*2, y*2, 3, 3 adaptive 1 }
plane { y, -1.05 pigment { color rgb <0.025,0.026,0.032> } finish { reflection { 0.06,0.24 } specular 0.35 } }
#declare HTex = texture { pigment { color rgb <0.9,0.18,0.35> } finish { specular 0.75 roughness 0.012 reflection 0.08 } }
#for (I, 0, 95)
  #declare T = I/95*720;
  #declare Y = -0.75 + I/95*2.9;
  sphere { <0.72*cos(radians(T)), Y, 0.72*sin(radians(T))>, 0.105 texture { HTex } }
#end
cylinder { <0,-0.9,0>, <0,2.35,0>, 0.035 pigment { color rgb <0.8,0.85,0.9> } finish { metallic specular 0.6 } }
`,
  },
  {
    name: 'sourced-folium',
    title: 'Folium loop (CC-BY sample adaptation)',
    category: 'implicit',
    tags: ['quartic', 'folium', 'math', 'loop', 'sample'],
    description: 'A folium-inspired loop of spheres draws an algebraic curve in space',
    author: 'Alexander Enzmann',
    sourceUrl: officialSceneUrl('objects/quartic/folium.pov'),
    license: 'CC-BY-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's objects/quartic/folium.pov sample by Alexander Enzmann.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <0, 2.3, -5.4> look_at <0, 0.55, 0> angle 38 }
light_source { <-3, 5, -4> color rgb <1.1,0.95,0.78> }
plane { y, -0.9 pigment { color rgb <0.035,0.038,0.044> } finish { reflection { 0.05,0.18 } } }
#declare FTex = texture { pigment { color rgb <0.18,0.85,0.62> } finish { specular 0.65 roughness 0.014 reflection 0.06 } }
#for (I, 0, 119)
  #declare T = radians(I*360/120);
  #declare R = 1.25*sin(2*T);
  sphere { <R*cos(T), 0.15 + 0.5*sin(T), R*sin(T)*0.65>, 0.075 texture { FTex } }
#end
sphere { <0,0.15,0>, 0.18 pigment { color rgb <1,0.85,0.18> } finish { emission 0.1 specular 0.5 } }
`,
  },
  {
    name: 'sourced-vector-rotation',
    title: 'Vector rotation demo (CC-BY-SA sample adaptation)',
    category: 'motion',
    tags: ['animation', 'vector', 'rotation', 'arrows', 'sample'],
    description: 'Clock-driven arrows rotate around a central axis for a clean motion demo',
    author: 'Chris Young',
    sourceUrl: officialSceneUrl('animations/vect1/vect1.pov'),
    license: 'CC-BY-SA-3.0',
    animated: true,
    frames: 36,
    fps: 18,
    source: `// Adapted from POV-Ray's animations/vect1/vect1.pov sample by Chris Young.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <3.4,2.6,-5.2> look_at <0,0.45,0> angle 40 }
light_source { <-4,5,-4> color rgb 1.15 }
plane { y, -0.05 pigment { color rgb <0.04,0.045,0.05> } finish { reflection { 0.04,0.16 } } }
cylinder { <0,0,0>, <0,1.7,0>, 0.025 pigment { color rgb <0.85,0.85,0.9> } }
#macro Arrow(A, Col)
  union {
    cylinder { <0,0.7,0>, <1.2,0.7,0>, 0.04 }
    cone { <1.2,0.7,0>, 0.12, <1.55,0.7,0>, 0 }
    pigment { color rgb Col } finish { specular 0.45 }
    rotate y*A
  }
#end
Arrow(clock*360, <1,0.1,0.05>)
Arrow(clock*360+120, <0.1,0.7,1>)
Arrow(clock*360+240, <0.35,1,0.25>)
`,
  },
  {
    name: 'sourced-camera-flythrough',
    title: 'Camera fly-through (CC-BY-SA sample adaptation)',
    category: 'motion',
    tags: ['animation', 'camera', 'flythrough', 'path', 'sample'],
    description: 'The camera glides along a short path through colored columns',
    author: 'Dieter Bayer',
    sourceUrl: officialSceneUrl('animations/camera2/camera2.pov'),
    license: 'CC-BY-SA-3.0',
    animated: true,
    frames: 48,
    fps: 24,
    source: `// Adapted from POV-Ray's animations/camera2/camera2.pov sample by Dieter Bayer.
#version 3.8;
global_settings { assumed_gamma 1.0 }

#declare CamZ = -5 + clock*5.5;
camera { location <1.6*sin(clock*2*pi), 1.2, CamZ> look_at <0, 0.75, 0.2+CamZ> angle 42 }
light_source { <0,5,-3> color rgb 1.1 }
plane { y, 0 pigment { checker color rgb <0.04,0.045,0.05>, color rgb <0.28,0.30,0.34> scale 0.8 } }
#for (I, -3, 5)
  cylinder { <-1.2,0,I>, <-1.2,1.8,I>, 0.12 pigment { color rgb <0.2+0.08*I,0.55,0.9> } finish { specular 0.35 } }
  cylinder { < 1.2,0,I>, < 1.2,1.8,I>, 0.12 pigment { color rgb <0.9,0.35+0.05*I,0.18> } finish { specular 0.35 } }
#end
`,
  },
  {
    name: 'sourced-glass-chess',
    title: 'Glass chess piece (CC-BY-SA sample adaptation)',
    category: 'optics',
    tags: ['glass', 'chess', 'refraction', 'lathe', 'sample'],
    description: 'A single refractive chess piece stands on a dark checker floor',
    author: 'Ingo Janssen',
    sourceUrl: officialSceneUrl('advanced/glasschess/glasschess.pov'),
    license: 'CC-BY-SA-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's glasschess.pov sample by Ingo Janssen.
#version 3.8;
global_settings { assumed_gamma 1.0 max_trace_level 12 }

camera { location <3, 2.2, -5.2> look_at <0, 0.85, 0> angle 36 }
light_source { <-4, 6, -4> color rgb <1.15,1.05,0.9> area_light x*2, y*2, 3, 3 adaptive 1 }
plane { y, 0 pigment { checker color rgb <0.03,0.032,0.038>, color rgb <0.8,0.82,0.84> scale 0.45 }
  finish { reflection { 0.08,0.24 } specular 0.5 roughness 0.01 } }
#declare GlassPiece = texture { pigment { color rgbf <0.86,0.96,1,0.8> } finish { diffuse 0.02 specular 0.95 roughness 0.004 reflection { 0.05,0.32 } } }
union {
  cylinder { <0,0,0>, <0,0.16,0>, 0.42 }
  cone { <0,0.16,0>, 0.26, <0,0.9,0>, 0.16 }
  sphere { <0,1.12,0>, 0.27 }
  torus { 0.24, 0.035 translate y*0.84 }
  texture { GlassPiece } interior { ior 1.52 }
}
`,
  },
  {
    name: 'sourced-area-light-grid',
    title: 'Area light grid (CC-BY sample adaptation)',
    category: 'lighting',
    tags: ['area-light', 'grid', 'shadow', 'sample'],
    description: 'A visible grid of area-light samples casts soft block shadows',
    author: 'POV-Ray sample scene authors',
    sourceUrl: officialSceneUrl('lights/arealit1.pov'),
    license: 'CC-BY-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's lights/arealit1.pov sample.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <3.2,2.4,-5> look_at <0,0.55,0> angle 38 }
light_source { <-3,5,-3> color rgb 1.1 area_light x*2, z*2, 3, 3 adaptive 1 jitter }
plane { y, 0 pigment { color rgb <0.72,0.72,0.68> } finish { diffuse 0.7 specular 0.12 } }
box { <-0.55,0,-0.55>, <0.55,0.85,0.55> pigment { color rgb <0.2,0.48,0.82> } finish { specular 0.35 } }
#for (X, -1, 1)
  #for (Z, -1, 1)
    sphere { <-3+X,5,-3+Z>, 0.055 pigment { color rgb <1,0.9,0.6> } finish { emission 0.4 diffuse 0 } no_shadow }
  #end
#end
`,
  },
  {
    name: 'sourced-orthographic-camera',
    title: 'Orthographic camera study (CC-BY sample adaptation)',
    category: 'camera',
    tags: ['camera', 'orthographic', 'scale', 'projection', 'sample'],
    description: 'An orthographic view flattens a clean row of colored solids',
    author: 'Fabien Mosen / Friedrich A. Lohmueller',
    sourceUrl: officialSceneUrl('camera/orthographic.pov'),
    license: 'CC-BY-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's camera/orthographic.pov sample by Fabien Mosen.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { orthographic location <3, 2.5, -6> look_at <0, 0.65, 0> right x*4 up y*3 }
light_source { <-4, 6, -4> color rgb <1.1,1.02,0.88> area_light x*2, y*2, 3, 3 adaptive 1 }
plane { y, 0 pigment { color rgb <0.05,0.055,0.065> } finish { reflection { 0.04,0.14 } specular 0.25 } }
#for (I, -2, 2)
  union {
    sphere { <0,0.55,0>, 0.38 }
    box { <-0.32,0,-0.32>, <0.32,0.26,0.32> }
    pigment { color rgb <0.25+I*0.12,0.55,0.82-I*0.08> }
    finish { specular 0.45 roughness 0.025 }
    translate <I*0.72,0,I*0.18>
  }
#end
`,
  },
  {
    name: 'sourced-omnimax-camera',
    title: 'Omnimax dome view (CC-BY sample adaptation)',
    category: 'camera',
    tags: ['camera', 'omnimax', 'dome', 'lens', 'sample'],
    description: 'A fisheye dome camera bends a tiny pavilion into a circular frame',
    author: 'Fabien Mosen / Friedrich A. Lohmueller',
    sourceUrl: officialSceneUrl('camera/omnimax.pov'),
    license: 'CC-BY-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's camera/omnimax.pov sample by Fabien Mosen.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { omnimax location <0, 1.0, -0.01> look_at <0, 1.0, 1> angle 180 }
light_source { <0, 5, -1> color rgb 1.1 }
sky_sphere { pigment { gradient y color_map { [0 rgb <0.05,0.08,0.18>] [1 rgb <0.56,0.76,1>] } } }
plane { y, 0 pigment { checker color rgb <0.08,0.09,0.1>, color rgb <0.7,0.74,0.76> scale 0.65 } }
#for (A, 0, 300, 60)
  cylinder { <1.4*cos(radians(A)),0,1.4*sin(radians(A))+1.6>,
             <1.4*cos(radians(A)),1.1,1.4*sin(radians(A))+1.6>, 0.08
    pigment { color rgb <0.9,0.6,0.25> } finish { specular 0.25 } }
#end
torus { 1.4, 0.035 translate <0,1.1,1.6> pigment { color rgb <0.9,0.9,0.75> } finish { specular 0.35 } }
sphere { <0,1.55,1.6>, 0.42 pigment { color rgb <0.12,0.42,0.8> } finish { specular 0.45 } }
`,
  },
  {
    name: 'sourced-spherical-camera',
    title: 'Spherical camera panorama (CC-BY sample adaptation)',
    category: 'camera',
    tags: ['camera', 'spherical', 'panorama', 'projection', 'sample'],
    description: 'A full spherical camera wraps towers and horizon into a panorama',
    author: 'Fabien Mosen / Friedrich A. Lohmueller',
    sourceUrl: officialSceneUrl('camera/spherical.pov'),
    license: 'CC-BY-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's camera/spherical.pov sample by Fabien Mosen.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { spherical location <0, 1.0, -0.2> look_at <0, 1.0, 1> angle 360, 180 }
light_source { <-4, 6, -3> color rgb <1.05,0.96,0.82> }
sky_sphere { pigment { gradient y color_map { [0 rgb <0.82,0.90,1>] [1 rgb <0.08,0.14,0.35>] } } }
plane { y, 0 pigment { color rgb <0.18,0.22,0.18> } normal { bumps 0.08 scale 0.45 } }
#for (A, 0, 330, 30)
  #declare R = 2.1 + 0.4*sin(radians(A*3));
  cylinder { <R*cos(radians(A)),0,R*sin(radians(A))>, <R*cos(radians(A)),0.65+0.35*mod(A/30,3),R*sin(radians(A))>, 0.12
    pigment { color rgb <0.25+0.5*mod(A/60,2),0.35,0.75> } finish { specular 0.25 } }
#end
`,
  },
  {
    name: 'sourced-ultra-wide-camera',
    title: 'Ultra wide angle room (CC-BY sample adaptation)',
    category: 'camera',
    tags: ['camera', 'wide-angle', 'interior', 'lens', 'sample'],
    description: 'A wide camera exaggerates a checker room and central sculpture',
    author: 'Fabien Mosen / Friedrich A. Lohmueller',
    sourceUrl: officialSceneUrl('camera/ultra_wide_angle.pov'),
    license: 'CC-BY-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's camera/ultra_wide_angle.pov sample by Fabien Mosen.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { ultra_wide_angle location <0, 1.0, -3.0> look_at <0, 0.8, 0> angle 110 }
light_source { <0, 4.5, -2.4> color rgb 1.05 area_light x*2, z*2, 3, 3 adaptive 1 }
plane { y, 0 pigment { checker color rgb <0.04,0.045,0.05>, color rgb <0.78,0.80,0.78> scale 0.5 } finish { specular 0.2 } }
plane { z, 2.2 pigment { checker color rgb <0.16,0.18,0.22>, color rgb <0.48,0.52,0.58> scale 0.45 } }
torus { 0.62, 0.08 rotate x*90 translate <0,0.82,0> pigment { color rgb <0.9,0.22,0.18> } finish { specular 0.55 } }
sphere { <0,0.82,0>, 0.28 pigment { color rgb <0.12,0.55,0.95> } finish { specular 0.7 reflection 0.08 } }
`,
  },
  {
    name: 'sourced-circular-area-light',
    title: 'Circular area light (CC-BY sample adaptation)',
    category: 'lighting',
    tags: ['area-light', 'circular', 'shadow', 'lighting', 'sample'],
    description: 'A circular area light leaves broad soft shadows around glossy forms',
    author: 'POV-Ray sample scene authors',
    sourceUrl: officialSceneUrl('lights/circular.pov'),
    license: 'CC-BY-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's lights/circular.pov sample.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <3.4,2.5,-5.2> look_at <0,0.55,0> angle 38 }
light_source { <-2.5,4.6,-3.5> color rgb 1.15 area_light x*2.5, z*2.5, 5, 5 circular orient adaptive 1 jitter }
plane { y, 0 pigment { color rgb <0.68,0.68,0.63> } finish { diffuse 0.72 specular 0.12 } }
box { <-0.75,0,-0.35>, <-0.25,0.85,0.35> pigment { color rgb <0.15,0.42,0.85> } finish { specular 0.35 } }
sphere { <0.45,0.48,0.08>, 0.48 pigment { color rgb <0.9,0.38,0.1> } finish { specular 0.55 roughness 0.02 } }
torus { 0.72, 0.025 rotate x*90 translate <-2.5,4.6,-3.5> pigment { color rgb <1,0.92,0.62> } finish { emission 0.3 diffuse 0 } no_shadow }
`,
  },
  {
    name: 'sourced-spotlight',
    title: 'Spotlight cone (CC-BY sample adaptation)',
    category: 'lighting',
    tags: ['spotlight', 'cone', 'shadow', 'lighting', 'sample'],
    description: 'A tight spotlight isolates one sphere on a dark studio floor',
    author: 'Alexander Enzmann / Drew Wells',
    sourceUrl: officialSceneUrl('lights/spotlite.pov'),
    license: 'CC-BY-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's lights/spotlite.pov sample by Alexander Enzmann and Drew Wells.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <2.8,2.0,-4.6> look_at <0,0.45,0> angle 38 }
background { color rgb <0.006,0.007,0.010> }
light_source { <-2,4,-3> color rgb <1.25,1.12,0.85> spotlight point_at <0,0.35,0> radius 8 falloff 18 tightness 18 }
light_source { <3,3,-4> color rgb <0.08,0.12,0.2> shadowless }
plane { y, 0 pigment { color rgb <0.025,0.026,0.03> } finish { reflection { 0.04,0.18 } specular 0.35 } }
sphere { <0,0.46,0>, 0.46 pigment { checker color rgb <0.92,0.92,0.82>, color rgb <0.18,0.22,0.32> scale 0.22 } finish { specular 0.65 roughness 0.018 } }
cone { <-2,4,-3>, 0.08, <0,0.38,0>, 0.72 pigment { color rgbf <1,0.78,0.35,0.88> } finish { emission 0.12 diffuse 0 } hollow no_shadow }
`,
  },
  {
    name: 'sourced-parallel-light',
    title: 'Parallel sun light (CC-BY sample adaptation)',
    category: 'lighting',
    tags: ['parallel', 'sun', 'shadow', 'lighting', 'sample'],
    description: 'Parallel light casts matching shadows from repeated columns',
    author: 'POV-Ray sample scene authors',
    sourceUrl: officialSceneUrl('lights/parallel_lights.pov'),
    license: 'CC-BY-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's lights/parallel_lights.pov sample.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <3.8,2.8,-5.4> look_at <0,0.7,0> angle 40 }
light_source { <-10, 10, -10> color rgb <1.1,1.0,0.82> parallel point_at <0,0,0> }
plane { y, 0 pigment { color rgb <0.70,0.71,0.68> } finish { diffuse 0.75 specular 0.1 } }
#for (I, -2, 2)
  cylinder { <I*0.55,0,0>, <I*0.55,1.25,0>, 0.12 pigment { color rgb <0.25,0.42+I*0.06,0.75> } finish { specular 0.25 } }
  sphere { <I*0.55,1.42,0>, 0.18 pigment { color rgb <0.9,0.75,0.28> } finish { specular 0.4 } }
#end
`,
  },
  {
    name: 'sourced-projected-through',
    title: 'Projected through glass (CC-BY sample adaptation)',
    category: 'lighting',
    tags: ['projected-through', 'glass', 'shadow', 'lighting', 'sample'],
    description: 'Colored panes tint projected light onto a small back wall',
    author: 'POV-Ray sample scene authors',
    sourceUrl: officialSceneUrl('lights/projected_through.pov'),
    license: 'CC-BY-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's lights/projected_through.pov sample.
#version 3.8;
global_settings { assumed_gamma 1.0 max_trace_level 6 }

camera { location <0,1.5,-5> look_at <0,0.75,0> angle 38 }
light_source { <0,2.1,-3.4> color rgb <1.2,1.15,1.05> projected_through { box { <-0.95,0.35,-1.3>, <0.95,1.45,-1.24> } } }
plane { y, 0 pigment { color rgb <0.045,0.045,0.05> } finish { reflection { 0.04,0.12 } } }
plane { z, 1.45 pigment { color rgb <0.72,0.74,0.78> } finish { diffuse 0.75 } }
#for (I, -1, 1)
  box { <-0.28,0.35,-1.3>, <0.28,1.45,-1.24> translate x*(I*0.55)
    pigment { color rgbf <0.3+0.3*I,0.45,0.9-0.25*I,0.55> } finish { specular 0.4 } interior { ior 1.2 } no_shadow }
#end
sphere { <0,0.42,0>, 0.42 pigment { color rgb <0.9,0.9,0.82> } finish { specular 0.45 } }
`,
  },
  {
    name: 'sourced-blob-cluster',
    title: 'Blob cluster (CC-BY sample adaptation)',
    category: 'implicit',
    tags: ['blob', 'metaball', 'implicit', 'sample'],
    description: 'Metaball components merge into a glossy organic cluster',
    author: 'Alexander Enzmann',
    sourceUrl: officialSceneUrl('objects/blob.pov'),
    license: 'CC-BY-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's objects/blob.pov sample by Alexander Enzmann.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <3.0,2.2,-4.8> look_at <0,0.65,0> angle 36 }
light_source { <-3,5,-4> color rgb <1.1,1.0,0.86> area_light x*2, y*2, 3, 3 adaptive 1 }
plane { y, -0.72 pigment { color rgb <0.035,0.038,0.045> } finish { reflection { 0.05,0.18 } specular 0.35 } }
blob {
  threshold 0.58
  sphere { <0,0,0>, 0.78, 1.0 }
  sphere { <0.55,0.22,0.12>, 0.54, 0.9 }
  sphere { <-0.52,0.08,-0.18>, 0.50, 0.85 }
  sphere { <0.05,0.58,-0.10>, 0.45, 0.82 }
  pigment { color rgb <0.8,0.12,0.42> }
  finish { specular 0.75 roughness 0.012 reflection 0.08 }
}
`,
  },
  {
    name: 'sourced-fractal-julia',
    title: 'Julia fractal shard (CC-BY sample adaptation)',
    category: 'implicit',
    tags: ['julia-fractal', 'fractal', 'math', 'sample'],
    description: 'A compact quaternion Julia shard floats over a dark floor',
    author: 'POV-Ray sample scene authors',
    sourceUrl: officialSceneUrl('objects/fractal1.pov'),
    license: 'CC-BY-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's objects/fractal1.pov sample.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <2.8,2.0,-4.4> look_at <0,0.25,0> angle 35 }
light_source { <-4,5,-4> color rgb <1.05,0.95,0.82> }
plane { y, -1.05 pigment { color rgb <0.03,0.032,0.038> } finish { reflection { 0.05,0.2 } specular 0.25 } }
julia_fractal {
  <-0.083, 0.0, -0.83, -0.025>
  quaternion sqr max_iteration 9 precision 80
  scale 1.15 rotate <12,32,0>
  pigment { color rgb <0.28,0.78,0.95> }
  finish { specular 0.65 roughness 0.012 reflection 0.05 }
}
`,
  },
  {
    name: 'sourced-isosurface-gallery',
    title: 'Isosurface gallery (CC-BY sample adaptation)',
    category: 'implicit',
    tags: ['isosurface', 'function', 'gallery', 'sample'],
    description: 'Four small function surfaces compare ripples, ridges, and saddles',
    author: 'Chris Huff',
    sourceUrl: officialSceneUrl('objects/isosurfaces.pov'),
    license: 'CC-BY-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's objects/isosurfaces.pov sample by Chris Huff.
#version 3.8;
global_settings { assumed_gamma 1.0 }
#include "functions.inc"

camera { location <3.6,2.6,-5.2> look_at <0,0.25,0> angle 42 }
light_source { <-4,6,-4> color rgb 1.1 area_light x*2, y*2, 3, 3 adaptive 1 }
plane { y, -0.7 pigment { color rgb <0.04,0.043,0.05> } finish { reflection { 0.04,0.14 } } }
isosurface {
  function { y + 0.22*sin(8*x) + 0.16*cos(8*z) }
  contained_by { box { <-0.8,-0.8,-0.8>, <0.8,0.8,0.8> } }
  max_gradient 4
  pigment { color rgb <0.9,0.32,0.18> } finish { specular 0.55 roughness 0.018 }
  translate <-1.0,0,0>
}
isosurface {
  function { sqrt(x*x+z*z)-0.42-0.08*sin(12*y) }
  contained_by { box { <-0.8,-0.8,-0.8>, <0.8,0.8,0.8> } }
  max_gradient 4
  pigment { color rgb <0.18,0.66,0.92> } finish { specular 0.55 roughness 0.018 }
  translate <0.95,0,0>
}
isosurface {
  function { x*x - y + z*z - 0.08 }
  contained_by { box { <-0.8,-0.8,-0.8>, <0.8,0.8,0.8> } }
  max_gradient 4
  pigment { color rgb <0.78,0.72,0.18> } finish { specular 0.55 roughness 0.018 }
  translate <-1.0,0,1.15>
}
isosurface {
  function { y*y - x*z - 0.05 }
  contained_by { box { <-0.8,-0.8,-0.8>, <0.8,0.8,0.8> } }
  max_gradient 4
  pigment { color rgb <0.52,0.85,0.38> } finish { specular 0.55 roughness 0.018 }
  translate <0.95,0,1.15>
}
`,
  },
  {
    name: 'sourced-lathe-gallery',
    title: 'Lathe gallery (CC-BY sample adaptation)',
    category: 'modeling',
    tags: ['lathe', 'surface-of-revolution', 'vase', 'sample'],
    description: 'Three lathe profiles show simple surfaces of revolution',
    author: 'Dieter Bayer / Friedrich A. Lohmueller',
    sourceUrl: officialSceneUrl('objects/lathe2.pov'),
    license: 'CC-BY-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's objects/lathe2.pov sample by Dieter Bayer.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <3.4,2.3,-5.0> look_at <0,0.8,0> angle 38 }
light_source { <-4,6,-4> color rgb <1.1,1.0,0.82> area_light x*2, y*2, 3, 3 adaptive 1 }
plane { y, 0 pigment { color rgb <0.045,0.047,0.052> } finish { reflection { 0.04,0.16 } specular 0.25 } }
#macro Vessel(X, Col)
  lathe {
    cubic_spline 7
    <0.18,0>, <0.48,0.08>, <0.35,0.45>, <0.52,0.9>, <0.28,1.35>, <0.42,1.55>, <0.26,1.68>
    pigment { color rgb Col } finish { specular 0.62 roughness 0.018 reflection 0.04 }
    translate <X,0,0>
  }
#end
Vessel(-1.05, <0.86,0.34,0.18>)
Vessel(0, <0.18,0.65,0.78>)
Vessel(1.05, <0.78,0.72,0.32>)
`,
  },
  {
    name: 'sourced-mesh2-cushion',
    title: 'Mesh2 cushion (CC-BY sample adaptation)',
    category: 'modeling',
    tags: ['mesh2', 'triangle', 'surface', 'sample'],
    description: 'A hand-built mesh2 patch forms a small faceted cushion',
    author: 'Christoph Hormann',
    sourceUrl: officialSceneUrl('objects/mesh2.pov'),
    license: 'CC-BY-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's objects/mesh2.pov sample by Christoph Hormann.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <2.8,2.0,-4.2> look_at <0,0.25,0> angle 35 }
light_source { <-3,5,-4> color rgb <1.1,1.0,0.86> area_light x*2, y*2, 3, 3 adaptive 1 }
plane { y, -0.35 pigment { color rgb <0.04,0.043,0.05> } finish { reflection { 0.04,0.16 } specular 0.25 } }
mesh2 {
  vertex_vectors { 9,
    <-1,0,-1>, <0,0.24,-1>, <1,0,-1>,
    <-1,0.18,0>, <0,0.58,0>, <1,0.18,0>,
    <-1,0,1>, <0,0.24,1>, <1,0,1> }
  face_indices { 8, <0,1,4>, <0,4,3>, <1,2,5>, <1,5,4>, <3,4,7>, <3,7,6>, <4,5,8>, <4,8,7> }
  pigment { color rgb <0.22,0.62,0.9> } finish { specular 0.55 roughness 0.018 }
}
`,
  },
  {
    name: 'sourced-prism-sweep',
    title: 'Prism sweep set (CC-BY sample adaptation)',
    category: 'modeling',
    tags: ['prism', 'sweep', 'extrusion', 'sample'],
    description: 'Three prism sweeps compare linear, conic, and star-like profiles',
    author: 'Dieter Bayer',
    sourceUrl: officialSceneUrl('objects/prism1.pov'),
    license: 'CC-BY-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's objects/prism1.pov sample by Dieter Bayer.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <3.6,2.4,-5.2> look_at <0,0.5,0> angle 38 }
light_source { <-4,6,-4> color rgb <1.12,1.02,0.84> area_light x*2, y*2, 3, 3 adaptive 1 }
plane { y, 0 pigment { color rgb <0.045,0.047,0.052> } finish { reflection { 0.04,0.16 } specular 0.22 } }
#macro StarPrism(X, Col)
  prism {
    linear_sweep linear_spline 0, 0.85, 11,
    <0,0.5>, <0.12,0.12>, <0.5,0.12>, <0.2,-0.08>, <0.32,-0.48>,
    <0,-0.25>, <-0.32,-0.48>, <-0.2,-0.08>, <-0.5,0.12>, <-0.12,0.12>, <0,0.5>
    rotate x*90 translate <X,0.85,0>
    pigment { color rgb Col } finish { specular 0.5 roughness 0.02 }
  }
#end
StarPrism(-1.0, <0.85,0.26,0.18>)
StarPrism(0, <0.20,0.64,0.85>)
StarPrism(1.0, <0.72,0.78,0.22>)
`,
  },
  {
    name: 'sourced-sor-gallery',
    title: 'Surface of revolution set (CC-BY sample adaptation)',
    category: 'modeling',
    tags: ['sor', 'surface-of-revolution', 'profile', 'sample'],
    description: 'Surface-of-revolution profiles become polished bottle silhouettes',
    author: 'Dieter Bayer',
    sourceUrl: officialSceneUrl('objects/sor1.pov'),
    license: 'CC-BY-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's objects/sor1.pov sample by Dieter Bayer.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <3.2,2.2,-5> look_at <0,0.8,0> angle 38 }
light_source { <-4,5,-4> color rgb <1.1,0.98,0.82> area_light x*2, y*2, 3, 3 adaptive 1 }
plane { y, 0 pigment { color rgb <0.04,0.044,0.052> } finish { reflection { 0.04,0.16 } specular 0.28 } }
#macro Bottle(X, Col)
  sor {
    7, <0.18,0>, <0.42,0.12>, <0.50,0.42>, <0.33,0.86>, <0.22,1.20>, <0.28,1.45>, <0.20,1.58>
    pigment { color rgbf <Col.x,Col.y,Col.z,0.15> } finish { specular 0.7 roughness 0.01 reflection 0.06 }
    interior { ior 1.35 }
    translate <X,0,0>
  }
#end
Bottle(-0.85, <0.9,0.34,0.18>)
Bottle(0.15, <0.18,0.62,0.86>)
Bottle(1.05, <0.48,0.82,0.32>)
`,
  },
  {
    name: 'sourced-superellipsoid-cubes',
    title: 'Superellipsoid cubes (CC-BY sample adaptation)',
    category: 'modeling',
    tags: ['superellipsoid', 'rounded-cube', 'shape', 'sample'],
    description: 'A row of superellipsoids shows rounded-cube exponents',
    author: 'Dieter Bayer',
    sourceUrl: officialSceneUrl('objects/superel1.pov'),
    license: 'CC-BY-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's objects/superel1.pov sample by Dieter Bayer.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <3.5,2.5,-5.0> look_at <0,0.65,0> angle 38 }
light_source { <-4,6,-4> color rgb <1.12,1.03,0.84> area_light x*2, y*2, 3, 3 adaptive 1 }
plane { y, -0.62 pigment { color rgb <0.045,0.048,0.055> } finish { reflection { 0.04,0.16 } specular 0.25 } }
#macro Super(X, E, Col)
  superellipsoid { <E,E> scale 0.58 translate <X,0,0>
    pigment { color rgb Col } finish { specular 0.65 roughness 0.015 reflection 0.04 } }
#end
Super(-1.15, 0.12, <0.88,0.22,0.18>)
Super(0, 0.28, <0.18,0.64,0.9>)
Super(1.15, 0.55, <0.75,0.76,0.24>)
`,
  },
  {
    name: 'sourced-torus-gallery',
    title: 'Torus gallery (CC-BY sample adaptation)',
    category: 'modeling',
    tags: ['torus', 'ring', 'primitive', 'sample'],
    description: 'Nested glossy torii compare scale, tilt, and material response',
    author: 'Dieter Bayer',
    sourceUrl: officialSceneUrl('objects/torus1.pov'),
    license: 'CC-BY-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's objects/torus1.pov sample by Dieter Bayer.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <3.1,2.1,-4.5> look_at <0,0.45,0> angle 36 }
light_source { <-4,5,-4> color rgb <1.1,1.0,0.86> area_light x*2, y*2, 3, 3 adaptive 1 }
plane { y, -0.72 pigment { color rgb <0.035,0.038,0.045> } finish { reflection { 0.05,0.2 } specular 0.25 } }
#for (I, -1, 1)
  torus { 0.48+0.08*I, 0.09 rotate <90, 18*I, 0> translate <I*0.82,0,0>
    pigment { color rgb <0.35+0.25*I,0.58,0.84-0.16*I> } finish { specular 0.72 roughness 0.012 reflection 0.06 } }
#end
`,
  },
  {
    name: 'sourced-lemniscate',
    title: 'Quartic lemniscate (CC-BY sample adaptation)',
    category: 'implicit',
    tags: ['quartic', 'lemniscate', 'math', 'sample'],
    description: 'A lemniscate-inspired figure-eight curve is traced with glossy beads',
    author: 'Alexander Enzmann',
    sourceUrl: officialSceneUrl('objects/quartic/lemnisca.pov'),
    license: 'CC-BY-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's objects/quartic/lemnisca.pov sample by Alexander Enzmann.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <0,2.2,-5.0> look_at <0,0.15,0> angle 37 }
light_source { <-3,5,-4> color rgb <1.1,0.98,0.82> }
plane { y, -0.55 pigment { color rgb <0.035,0.038,0.045> } finish { reflection { 0.04,0.16 } } }
#declare LTex = texture { pigment { color rgb <0.95,0.25,0.48> } finish { specular 0.65 roughness 0.014 reflection 0.05 } }
#for (I, 0, 127)
  #declare T = radians(I*360/128);
  #declare D = 1 + pow(sin(T),2);
  sphere { <1.45*cos(T)/D, 0.15 + 0.35*sin(2*T), 1.45*sin(T)*cos(T)/D>, 0.055 texture { LTex } }
#end
`,
  },
  {
    name: 'sourced-monkey-saddle',
    title: 'Monkey saddle surface (CC-BY sample adaptation)',
    category: 'implicit',
    tags: ['quartic', 'saddle', 'math', 'surface', 'sample'],
    description: 'A sampled saddle surface turns algebraic curvature into a mesh',
    author: 'Alexander Enzmann',
    sourceUrl: officialSceneUrl('objects/quartic/monkey.pov'),
    license: 'CC-BY-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's objects/quartic/monkey.pov sample by Alexander Enzmann.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <3.2,2.3,-4.8> look_at <0,0,0> angle 38 }
light_source { <-4,6,-4> color rgb <1.1,1.0,0.84> area_light x*2, y*2, 3, 3 adaptive 1 }
plane { y, -0.75 pigment { color rgb <0.035,0.038,0.046> } finish { reflection { 0.04,0.16 } specular 0.25 } }
#for (X, -6, 6)
  #for (Z, -6, 6)
    #declare xx = X/6;
    #declare zz = Z/6;
    #declare yy = 0.22*(xx*xx*xx - 3*xx*zz*zz);
    sphere { <xx, yy, zz>, 0.045 pigment { color rgb <0.2+0.35*(xx+1)/2,0.65,0.9-0.35*(zz+1)/2> } finish { specular 0.45 } }
  #end
#end
`,
  },
  {
    name: 'sourced-steiner-surface',
    title: 'Steiner surface (CC-BY sample adaptation)',
    category: 'implicit',
    tags: ['quartic', 'steiner', 'math', 'surface', 'sample'],
    description: 'A compact Steiner-inspired surface forms a self-crossing shell',
    author: 'Alexander Enzmann',
    sourceUrl: officialSceneUrl('objects/quartic/steiner.pov'),
    license: 'CC-BY-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's objects/quartic/steiner.pov sample by Alexander Enzmann.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <3.1,2.2,-4.7> look_at <0,0.2,0> angle 36 }
light_source { <-4,5,-4> color rgb <1.08,0.98,0.82> area_light x*2, y*2, 3, 3 adaptive 1 }
plane { y, -0.85 pigment { color rgb <0.032,0.035,0.042> } finish { reflection { 0.04,0.16 } } }
isosurface {
  function { pow(x*x+y*y+z*z,2) - 0.82*(x*x*y*y + y*y*z*z + z*z*x*x) - 0.055 }
  contained_by { sphere { <0,0,0>, 1.35 } }
  max_gradient 6
  pigment { color rgb <0.18,0.74,0.82> }
  finish { specular 0.62 roughness 0.014 reflection 0.06 }
  rotate <10,26,0>
}
`,
  },
  {
    name: 'sourced-witch-surface',
    title: 'Witch curve surface (CC-BY sample adaptation)',
    category: 'implicit',
    tags: ['quartic', 'witch', 'math', 'curve', 'sample'],
    description: 'A witch-of-Agnesi-inspired curve becomes a luminous bead arc',
    author: 'Alexander Enzmann',
    sourceUrl: officialSceneUrl('objects/quartic/witch.pov'),
    license: 'CC-BY-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's objects/quartic/witch.pov sample by Alexander Enzmann.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <0,2.2,-5.2> look_at <0,0.55,0> angle 36 }
light_source { <-3,5,-4> color rgb <1.1,0.98,0.82> }
plane { y, -0.05 pigment { color rgb <0.035,0.038,0.045> } finish { reflection { 0.04,0.15 } } }
#for (I, -42, 42)
  #declare X = I/18;
  #declare Y = 1.65/(1 + X*X);
  sphere { <X, Y, 0.18*sin(I*0.35)>, 0.055
    pigment { color rgb <0.9,0.36+0.25*Y/1.65,0.15> } finish { specular 0.55 } }
#end
`,
  },
  {
    name: 'sourced-agate-pattern',
    title: 'Agate pattern wall (CC-BY sample adaptation)',
    category: 'texturing',
    tags: ['agate', 'pattern', 'texture', 'sample'],
    description: 'Agate bands wrap a row of spheres with varied turbulence',
    author: 'POV-Ray sample scene authors',
    sourceUrl: officialSceneUrl('textures/patterns/agate.pov'),
    license: 'CC-BY-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's textures/patterns/agate.pov sample.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <0,2.1,-5> look_at <0,0.55,0> angle 38 }
light_source { <-3,5,-4> color rgb 1.1 }
plane { y, 0 pigment { color rgb <0.045,0.047,0.052> } finish { reflection { 0.04,0.16 } } }
#for (I, -2, 2)
  sphere { <I*0.58,0.55,0>, 0.42
    pigment { agate color_map { [0 rgb <0.12,0.05,0.03>] [0.45 rgb <0.8,0.42,0.18>] [1 rgb <1,0.86,0.48>] } turbulence 0.45+0.08*I scale 0.35 }
    finish { specular 0.42 roughness 0.025 } }
#end
`,
  },
  {
    name: 'sourced-marble-pattern',
    title: 'Marble material row (CC-BY sample adaptation)',
    category: 'texturing',
    tags: ['marble', 'pattern', 'texture', 'veins', 'sample'],
    description: 'Procedural marble veins cut across polished primitive shapes',
    author: 'POV-Ray sample scene authors',
    sourceUrl: officialSceneUrl('textures/patterns/marble.pov'),
    license: 'CC-BY-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's textures/patterns/marble.pov sample.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <3.0,2.1,-4.8> look_at <0,0.55,0> angle 36 }
light_source { <-4,5,-4> color rgb <1.12,1.02,0.86> area_light x*2, y*2, 3, 3 adaptive 1 }
plane { y, 0 pigment { color rgb <0.035,0.038,0.045> } finish { reflection { 0.05,0.2 } specular 0.25 } }
#declare MarbleTex = texture {
  pigment { marble color_map { [0 rgb <0.95,0.93,0.84>] [0.42 rgb <0.32,0.34,0.38>] [1 rgb <0.85,0.78,0.62>] } turbulence 0.7 scale 0.45 }
  finish { specular 0.6 roughness 0.018 reflection 0.06 }
}
sphere { <-0.85,0.52,0>, 0.52 texture { MarbleTex } }
box { <-0.2,0, -0.45>, <0.65,0.85,0.4> rotate y*18 texture { MarbleTex } }
torus { 0.42, 0.09 rotate x*90 translate <1.18,0.55,0> texture { MarbleTex } }
`,
  },
  {
    name: 'sourced-spiral-pattern',
    title: 'Spiral pigment disks (CC-BY sample adaptation)',
    category: 'texturing',
    tags: ['spiral', 'pattern', 'pigment', 'sample'],
    description: 'Spiral pigments turn flat disks into bold procedural targets',
    author: 'POV-Ray sample scene authors',
    sourceUrl: officialSceneUrl('textures/patterns/spiral1.pov'),
    license: 'CC-BY-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's textures/patterns/spiral1.pov sample.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <0,1.6,-4.2> look_at <0,0.7,0> angle 38 }
light_source { <0,4,-4> color rgb 1.1 }
plane { y, 0 pigment { color rgb <0.04,0.043,0.05> } finish { reflection { 0.04,0.14 } } }
#for (I, -1, 1)
  disc { <I*0.82,0.78,0>, -z, 0.38
    pigment { spiral1 5 color_map { [0 rgb <0.95,0.22,0.12>] [0.5 rgb <1,0.92,0.25>] [1 rgb <0.1,0.45,0.9>] } scale 0.34 rotate z*(I*25) }
    finish { specular 0.35 } }
#end
`,
  },
  {
    name: 'sourced-crackle-cells',
    title: 'Crackle cell material (CC-BY sample adaptation)',
    category: 'texturing',
    tags: ['crackle', 'cells', 'pattern', 'sample'],
    description: 'Crackle pigment cells turn blocks into chipped ceramic tiles',
    author: 'POV-Ray sample scene authors',
    sourceUrl: officialSceneUrl('textures/patterns/crackle1.pov'),
    license: 'CC-BY-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's textures/patterns/crackle1.pov sample.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <3.2,2.2,-4.8> look_at <0,0.45,0> angle 37 }
light_source { <-4,5,-4> color rgb <1.1,1.0,0.86> }
plane { y, 0 pigment { color rgb <0.035,0.038,0.045> } finish { reflection { 0.04,0.16 } } }
#declare CellTex = texture {
  pigment { crackle color_map { [0 rgb <0.08,0.10,0.12>] [0.08 rgb <0.18,0.22,0.26>] [1 rgb <0.88,0.72,0.42>] } scale 0.32 }
  normal { crackle 0.18 scale 0.32 }
  finish { specular 0.28 roughness 0.04 }
}
#for (X, -1, 1)
  box { <-0.35,0,-0.35>, <0.35,0.55,0.35> translate <X*0.82,0,0> texture { CellTex } }
#end
`,
  },
  {
    name: 'sourced-pavement-tiles',
    title: 'Pavement tile swatch (CC-BY sample adaptation)',
    category: 'texturing',
    tags: ['pavement', 'tiles', 'pattern', 'sample'],
    description: 'A pavement-style procedural tile grid makes an ornate floor swatch',
    author: 'POV-Ray sample scene authors',
    sourceUrl: officialSceneUrl('textures/patterns/pavement.pov'),
    license: 'CC-BY-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's textures/patterns/pavement.pov sample.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <0,4.0,-3.4> look_at <0,0,0> angle 42 }
light_source { <-3,5,-4> color rgb <1.1,1.0,0.86> }
#for (X, -4, 4)
  #for (Z, -4, 4)
    #declare Shift = 0.22*mod(Z+4,2);
    #declare C = mod(X + Z + 8, 3);
    box { <-0.18,0,-0.18>, <0.18,0.025,0.18> translate <X*0.42+Shift,0,Z*0.38>
      pigment { color rgb <0.28+0.12*C,0.32+0.08*mod(C+1,3),0.38+0.08*mod(C+2,3)> }
      finish { specular 0.18 roughness 0.04 } }
  #end
#end
sphere { <0,0.32,0>, 0.32 pigment { color rgb <0.88,0.24,0.18> } finish { specular 0.55 } }
`,
  },
  {
    name: 'sourced-object-pattern',
    title: 'Object pattern bands (CC-BY-SA sample adaptation)',
    category: 'texturing',
    tags: ['object-pattern', 'warp', 'radiosity', 'sample'],
    description: 'Object-pattern logic cuts colored bands through a simple sculpture',
    author: 'Christoph Hormann',
    sourceUrl: officialSceneUrl('advanced/object_pattern.pov'),
    license: 'CC-BY-SA-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's advanced/object_pattern.pov sample by Christoph Hormann.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <3.1,2.1,-4.8> look_at <0,0.65,0> angle 36 }
light_source { <-4,5,-4> color rgb <1.1,1.0,0.82> area_light x*2, y*2, 3, 3 adaptive 1 }
plane { y, 0 pigment { color rgb <0.035,0.038,0.045> } finish { reflection { 0.04,0.16 } specular 0.25 } }
#declare Cutter = union { sphere { <0,0.75,0>, 0.5 } cylinder { <-0.5,0.75,0>, <0.5,0.75,0>, 0.25 } }
union {
  sphere { <0,0.75,0>, 0.72 }
  torus { 0.72, 0.09 translate y*0.75 }
  pigment { object { Cutter color rgb <0.86,0.22,0.16>, color rgb <0.12,0.56,0.88> } warp { cylindrical orientation y } }
  finish { specular 0.62 roughness 0.015 reflection 0.06 }
}
`,
  },
  {
    name: 'sourced-whiltile',
    title: 'While-loop tile floor (CC-BY-SA sample adaptation)',
    category: 'generative',
    tags: ['while-loop', 'tile', 'procedural', 'sample'],
    description: 'Nested loops build a patterned tile floor from repeated geometry',
    author: 'Eduard Schwan / Dan Farmer',
    sourceUrl: officialSceneUrl('advanced/whiltile.pov'),
    license: 'CC-BY-SA-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's advanced/whiltile.pov sample by Eduard Schwan and Dan Farmer.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <0,5.5,-6.8> look_at <0,0,0> angle 42 }
light_source { <-3,6,-4> color rgb <1.1,1.0,0.82> }
#declare X = -4;
#while (X <= 4)
  #declare Z = -4;
  #while (Z <= 4)
    box { <-0.45,0,-0.45>, <0.45,0.035,0.45> translate <X*0.46,0,Z*0.46>
      pigment { color rgb <0.22+0.08*mod(X+Z+8,3),0.28+0.05*mod(X+8,2),0.38+0.07*mod(Z+8,3)> }
      finish { specular 0.18 roughness 0.04 } }
    #declare Z = Z + 1;
  #end
  #declare X = X + 1;
#end
sphere { <0,0.34,0>, 0.34 pigment { color rgb <0.9,0.76,0.28> } finish { specular 0.55 } }
`,
  },
  {
    name: 'sourced-float-math',
    title: 'Float math axes (CC-BY-SA sample adaptation)',
    category: 'generative',
    tags: ['float', 'math', 'loop', 'axes', 'sample'],
    description: 'Looped math plots bead markers along sine and cosine axes',
    author: 'POV-Ray sample scene authors',
    sourceUrl: officialSceneUrl('advanced/float5.pov'),
    license: 'CC-BY-SA-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's advanced/float5.pov sample.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <0,2.6,-6.0> look_at <0,0.25,0> angle 38 }
light_source { <-3,5,-4> color rgb 1.1 }
plane { y, -0.75 pigment { color rgb <0.035,0.038,0.045> } finish { reflection { 0.04,0.16 } } }
cylinder { <-2.2,0,0>, <2.2,0,0>, 0.018 pigment { color rgb <0.85,0.85,0.9> } }
cylinder { <0,-0.55,0>, <0,1.35,0>, 0.018 pigment { color rgb <0.85,0.85,0.9> } }
#declare I = -40;
#while (I <= 40)
  #declare X = I/18;
  #declare Y = 0.55*sin(I/5);
  sphere { <X,Y,0>, 0.045 pigment { color rgb <0.18,0.58+0.22*cos(I/8),0.92> } finish { specular 0.45 } }
  #declare I = I + 1;
#end
`,
  },
  {
    name: 'sourced-abyss-field',
    title: 'Abyss field (CC-BY-SA sample adaptation)',
    category: 'environment',
    tags: ['abyss', 'field', 'atmosphere', 'terrain', 'sample'],
    description: 'A minimal abyss landscape stages a tiny craft over a striped field',
    author: 'Gilles Tran',
    sourceUrl: officialSceneUrl('advanced/abyss.pov'),
    license: 'CC-BY-SA-3.0',
    animated: false,
    frames: null,
    fps: null,
    source: `// Adapted from POV-Ray's advanced/abyss.pov sample by Gilles Tran.
#version 3.8;
global_settings { assumed_gamma 1.0 }

camera { location <0,1.2,-6.2> look_at <0,0.25,2.5> angle 46 }
sky_sphere { pigment { gradient y color_map { [0 rgb <0.80,0.83,0.86>] [1 rgb <0.14,0.18,0.28>] } } }
light_source { <-4,5,-3> color rgb <1.1,0.98,0.78> }
fog { distance 9 color rgb <0.55,0.62,0.68> fog_offset 0.1 fog_alt 1.1 }
plane { y, 0 pigment { gradient x color_map { [0 rgb <0.10,0.11,0.12>] [0.5 rgb <0.38,0.34,0.25>] [1 rgb <0.10,0.11,0.12>] } scale 0.42 } finish { diffuse 0.78 } }
union {
  sphere { <0,0.45,1.2>, 0.32 scale <1.6,0.32,0.55> }
  cylinder { <-0.7,0.45,1.2>, <0.7,0.45,1.2>, 0.035 }
  pigment { color rgb <0.72,0.76,0.72> } finish { specular 0.45 reflection 0.04 }
}
`,
  },
];
