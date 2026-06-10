// Sourced POV-Ray SDL scene adaptations kept separate from the in-house examples.
// Imported by examples.js so the public EXAMPLES order and API stay unchanged.
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
];
