# syntax=docker/dockerfile:1
ARG EMSDK_VERSION=5.0.7
ARG POVRAY_COMMIT=c3ce13e5bb51892d8f59c1148b5f905a01ef82f3

# --platform=$BUILDPLATFORM: the wasm output is arch-independent, so this stage
# always runs natively on the build host; only the runtime stage is per-platform.
FROM --platform=$BUILDPLATFORM emscripten/emsdk:${EMSDK_VERSION} AS builder
ARG POVRAY_COMMIT
# Debug/tuning knobs:
#   LINK_EXTRA      extra flags appended to the final em++ link
#                   (e.g. --build-arg LINK_EXTRA="-sASSERTIONS=2 -sSTACK_OVERFLOW_CHECK=2")
#   WASM_MAX_MEMORY shared-memory maximum. Default 2GB instantiates on
#                   Safari/iOS; Chrome/Firefox treat the max as an address-space
#                   reservation, so the published Node CLI image is built with
#                   4GB (--build-arg WASM_MAX_MEMORY=4GB) where Safari is moot.
ARG LINK_EXTRA=""
ARG WASM_MAX_MEMORY=2GB

RUN apt-get update && apt-get install -y --no-install-recommends \
      autoconf automake m4 patch curl ca-certificates unzip && \
    rm -rf /var/lib/apt/lists/*

# Shared flag sets. Ports must be present at BOTH compile and link;
# they also go in CPPFLAGS so configure's AC_CHECK_HEADER probes see the sysroot.
ENV POV_PORTS="--use-port=zlib --use-port=libpng --use-port=libjpeg --use-port=boost_headers"
ENV POV_CXXFLAGS="-O3 -pthread -fwasm-exceptions -msimd128 -fno-strict-aliasing -fno-math-errno"

# Warm the emscripten port cache in its own layer, with the exact flag combo the
# real build uses, so the right variants (zlib-mt, libpng-mt-legacysjlj, ...) are
# built once and survive source-level cache busts.
RUN echo 'int main(){return 0;}' > /tmp/warm.c && \
    emcc /tmp/warm.c -O3 -pthread -fwasm-exceptions -msimd128 ${POV_PORTS} \
      -sENVIRONMENT=web,worker,node -o /tmp/warm.mjs && rm -f /tmp/warm.*

# Pinned source fetch (no git history needed)
WORKDIR /build
RUN curl -fsSL "https://github.com/POV-Ray/povray/archive/${POVRAY_COMMIT}.tar.gz" \
      | tar xz && mv "povray-${POVRAY_COMMIT}" povray

# Patches: applied to pristine source, BEFORE prebuild.sh (so bootstrap
# regenerates configure from the patched m4 macros).
COPY patches/ /build/patches/
RUN cd povray && for p in /build/patches/*.patch; do patch -p1 < "$p"; done

# Tree surgery, also pre-prebuild:
#  - povmain.cpp has a main() whose ALTMAIN guard is frontend-config-blind; remove the file.
#  - unixconsole.cpp: sigwait thread + termios; replaced by our console.
#  - touch a stub with the final name NOW so prebuild's `find vfe/unix -name *.cpp`
#    lists it in libvfe_a_SOURCES; the real content is COPYed in a LATER layer so
#    console iteration doesn't invalidate the configure + libpovray.a layers.
RUN cd povray && \
    rm source/povmain.cpp vfe/unix/unixconsole.cpp && \
    touch vfe/unix/povrayer_console.cpp

# prebuild + configure.
# prebuild.sh discards bootstrap's exit code (ok=`cd $dir/; ./bootstrap`, no
# set -e); a broken autoconf run would otherwise surface a layer later as
# "./configure: No such file". Guard explicitly.
RUN cd povray/unix && ./prebuild.sh && test -x ../configure

# --build comes from config.guess because the emsdk image is multi-arch
# (amd64 + arm64): a hardcoded x86_64 triple lies on Apple Silicon hosts.
# automake --add-missing (run by bootstrap) installs config.guess into
# AC_CONFIG_AUX_DIR = unix/config (configure.ac:52).
#
# Configure cache seeds: AC_SEARCH_LIBS link tests use K&R prototypes
# (`char zlibVersion();`) that hit wasm-ld signature-mismatch errors. Seeding
# ac_cv_search_*="none required" skips the link test entirely; the port
# archives are injected by ${POV_PORTS} in LDFLAGS at every link anyway.
#
# -DHAVE_NAN/-DHAVE_INF: the NaN/Inf AC_RUN_IFELSE probes silently leave the
# macros undefined when cross-compiling, collapsing POV_ISNAN/POV_ISINF to
# (false). Wasm is strict IEEE-754; force them on.
RUN cd povray && emconfigure ./configure \
      COMPILED_BY="povrayer (https://github.com/swhitt/povrayer)" \
      NON_REDISTRIBUTABLE_BUILD=yes \
      --build="$(unix/config/config.guess)" \
      --host=wasm32-unknown-emscripten \
      --prefix=/usr \
      --without-libtiff --without-openexr \
      --without-x --without-libsdl \
      --disable-io-restrictions \
      --disable-strip --disable-optimiz --disable-optimiz-arch \
      ac_cv_search_zlibVersion="none required" \
      ac_cv_search_png_get_libpng_ver="none required" \
      ac_cv_search_jpeg_std_error="none required" \
      CPPFLAGS="${POV_PORTS} -DHAVE_NAN -DHAVE_STD_ISNAN -DHAVE_INF -DHAVE_STD_ISINF" \
      CXXFLAGS="${POV_CXXFLAGS}" \
      LDFLAGS="-pthread -fwasm-exceptions ${POV_PORTS}"

# Big, stable layers: core + platform libs (168 + a handful of TUs)
RUN cd povray && emmake make -j"$(nproc)" -C source
RUN cd povray && emmake make -j"$(nproc)" -C platform

# Iterating layer: real console content, then the small vfe lib
COPY src/povrayer_console.cpp /build/povray/vfe/unix/povrayer_console.cpp
RUN cd povray && emmake make -j"$(nproc)" -C vfe

# Lightsys IV + the CIE XYZ colour-space macros (Jaime Vives Piqueres & "Ive",
# bundling Philippe Debar's Skylight adaptation), licensed CC-BY-SA-4.0 per
# https://www.ignorancia.org/index.php?page=lightsys . Fetched at build time so
# the package is never vendored into this repo, then dropped FLAT into the
# POV-Ray include dir embedded just below, so scenes can `#include "CIE.inc"` /
# "lightsys.inc" etc. exactly like the stdlib includes. Only the 17 top-level
# .inc files (not the demo/test scenes) are embedded. Pinned by sha256 for a
# reproducible build; if the origin is down, the Internet Archive has a snapshot
# (web.archive.org/web/20150911013706id_/<the URL below>).
ARG LIGHTSYS_URL="http://www.ignorancia.org/uploads/zips/lightsys4d.zip"
ARG LIGHTSYS_SHA256="d302b96a669ac776ac856fbd480427eb92c327099fd2856748a1d7bf6a8c84d1"
RUN curl -fsSL --retry 3 --retry-delay 2 -o /tmp/lightsys.zip "${LIGHTSYS_URL}" \
      && printf '%s  /tmp/lightsys.zip\n' "${LIGHTSYS_SHA256}" | sha256sum -c - \
      && unzip -j -o /tmp/lightsys.zip 'LightsysIV/*.inc' -x 'LightsysIV/*/*.inc' \
           -d povray/distribution/include \
      && rm /tmp/lightsys.zip

# Final link, hand-rolled for full control of -s flags and .mjs output.
# libvfe.a listed twice: cyclic deps with libpovray.a (same as upstream LDADD).
# PTHREAD_POOL_SIZE budget: proxied main + vfe worker + backend main +
# scene/view control + N render tasks = N+5; the navigator guard is required
# because the expression also evaluates in Node (< 21 has no navigator global).
RUN mkdir -p /out && cd povray && em++ \
      vfe/libvfe.a source/libpovray.a vfe/libvfe.a platform/libplatform.a \
      -o /out/povray.mjs \
      ${POV_CXXFLAGS} \
      ${POV_PORTS} \
      -sENVIRONMENT=web,worker,node \
      -sMODULARIZE -sEXPORT_ES6 -sEXPORT_NAME=createPovray \
      -sPROXY_TO_PTHREAD \
      -sALLOW_MEMORY_GROWTH -sINITIAL_MEMORY=256MB -sMAXIMUM_MEMORY=${WASM_MAX_MEMORY} \
      -sSTACK_SIZE=8MB -sDEFAULT_PTHREAD_STACK_SIZE=8MB \
      -sPTHREAD_POOL_SIZE="(typeof navigator!=='undefined'&&navigator.hardwareConcurrency?navigator.hardwareConcurrency:8)+6" \
      -sINVOKE_RUN=0 -sEXIT_RUNTIME=1 \
      -sEXPORTED_FUNCTIONS=_main \
      -sEXPORTED_RUNTIME_METHODS=callMain,FS,PThread \
      ${LINK_EXTRA} \
      --embed-file distribution/ini@/usr/share/povray-3.8/ini \
      --embed-file distribution/include@/usr/share/povray-3.8/include

# Arch-independent JS output; same native-platform treatment as the builder.
FROM --platform=$BUILDPLATFORM node:22-alpine AS wrapper-build
WORKDIR /wrapper
# package-lock.json is committed to the repo; npm ci requires it,
# and BuildKit fails the COPY without it.
COPY wrapper/package.json wrapper/package-lock.json wrapper/tsconfig.json ./
RUN npm ci
COPY wrapper/src ./src
RUN npx tsc

FROM scratch AS artifact
COPY --from=builder /out/povray.mjs /out/povray.wasm /
COPY --from=wrapper-build /wrapper/dist/index.js /wrapper/dist/index.d.ts /
COPY --from=wrapper-build /wrapper/package.json /package.json

FROM node:22-alpine AS runtime
LABEL org.opencontainers.image.source="https://github.com/swhitt/povrayer" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.description="POV-Ray 3.8 compiled to WebAssembly (pthreads, wasm EH)"
COPY --from=builder /out/ /app/
COPY --from=wrapper-build /wrapper/dist/ /app/
# "type": "module" scope for /app/index.js. Without it, loading the tsc-emitted
# ESM leans on Node's module-syntax detection (default only since 22.7), an
# implicit floor on the base image plus a double-parse on every start.
COPY --from=wrapper-build /wrapper/package.json /app/package.json
COPY src/cli.mjs /app/cli.mjs
WORKDIR /work
ENTRYPOINT ["node", "/app/cli.mjs"]
