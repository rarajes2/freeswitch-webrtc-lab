# syntax=docker/dockerfile:1
#
# FreeSWITCH, built from source -- no prebuilt `signalwire/freeswitch` image,
# no SignalWire-hosted package repo/token. Everything here compiles from
# public, unauthenticated git sources. See docs/INTAKE.md §2.
#
# Build order (verified against the actual FreeSWITCH v1.10.12 configure.ac,
# which hard-requires these two libs at newer versions than Debian bookworm
# ships):
#   1. sofia-sip  (freeswitch/sofia-sip, >= 1.13.17 required; bookworm has 1.12.11)
#   2. spandsp    (freeswitch/spandsp,   >= 3.0 required;     bookworm has 0.0.6)
#   3. FreeSWITCH itself, with a trimmed modules.conf (see ../modules.conf)

FROM debian:bookworm-slim AS builder
ARG SOFIA_SIP_VERSION=v1.13.18
ARG SPANDSP_VERSION=v3.1.1
ARG FREESWITCH_VERSION=v1.10.12
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential autoconf automake libtool libtool-bin pkg-config git ca-certificates \
        libssl-dev libcurl4-openssl-dev libpcre3-dev libsqlite3-dev libedit-dev \
        libspeex-dev libspeexdsp-dev libldns-dev libsndfile1-dev libopus-dev \
        libjpeg62-turbo-dev zlib1g-dev uuid-dev libtiff-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src

# --- sofia-sip (SIP stack) ---
RUN git clone --depth 1 --branch ${SOFIA_SIP_VERSION} https://github.com/freeswitch/sofia-sip.git \
    && cd sofia-sip \
    && ./bootstrap.sh \
    && ./configure --prefix=/usr --disable-static \
    && make -j"$(nproc)" \
    && make install \
    && ldconfig

# --- spandsp (DSP library FreeSWITCH's core links against) ---
RUN git clone --depth 1 --branch ${SPANDSP_VERSION} https://github.com/freeswitch/spandsp.git \
    && cd spandsp \
    && ./bootstrap.sh \
    && ./configure --prefix=/usr --disable-static \
    && make -j"$(nproc)" \
    && make install \
    && ldconfig

# --- FreeSWITCH itself ---
RUN git clone --depth 1 --branch ${FREESWITCH_VERSION} https://github.com/signalwire/freeswitch.git
COPY modules.conf /usr/src/freeswitch/modules.conf
WORKDIR /usr/src/freeswitch
RUN ./bootstrap.sh -j \
    && ./configure --prefix=/usr/local/freeswitch --enable-portable-binary \
    && make -j"$(nproc)" \
    && make install \
    # `make install` seeds /usr/local/freeswitch/etc/freeswitch with
    # FreeSWITCH's own full default ("vanilla") sample config -- unused here
    # since we run with -conf pointing at our own conf/ (see CMD below) and
    # only bloats the image otherwise.
    && rm -rf /usr/local/freeswitch/etc

# ---------------------------------------------------------------------------
FROM debian:bookworm-slim AS runtime
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        libssl3 libcurl4 libpcre3 libsqlite3-0 libedit2 libspeex1 libspeexdsp1 \
        libldns3 libsndfile1 libopus0 libjpeg62-turbo zlib1g libuuid1 libtiff6 \
        openssl ca-certificates gosu \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -r freeswitch --gid=999 \
    && useradd -r -g freeswitch --uid=999 --home-dir=/usr/local/freeswitch freeswitch

# FreeSWITCH binaries/modules + the sofia-sip/spandsp shared libs it links against
COPY --from=builder /usr/local/freeswitch /usr/local/freeswitch
COPY --from=builder /usr/lib/libsofia-sip-ua*.so* /usr/lib/
COPY --from=builder /usr/lib/libspandsp*.so* /usr/lib/
RUN ldconfig

ENV PATH="/usr/local/freeswitch/bin:${PATH}"
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
    && mkdir -p /usr/local/freeswitch/conf/tls \
    && chown -R freeswitch:freeswitch /usr/local/freeswitch

# SIP (5060/5080), TLS-SIP (5061/5081), WS/WSS (5066/7443), ESL (8021, internal-only)
EXPOSE 5060/udp 5060/tcp 5080/udp 5080/tcp
EXPOSE 5061/tcp 5081/tcp
EXPOSE 5066/tcp 7443/tcp
EXPOSE 8021/tcp

VOLUME ["/usr/local/freeswitch/conf", "/usr/local/freeswitch/log", "/usr/local/freeswitch/storage", "/usr/local/freeswitch/recordings"]

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s \
    CMD fs_cli -x status | grep -q ^UP || exit 1

# -conf: FreeSWITCH's autotools install layout puts its *default* full
# sample config (the ~13k-line vanilla document -- chatplan, IVR menus, the
# works) at /usr/local/freeswitch/etc/freeswitch, NOT /usr/local/freeswitch/
# conf -- without an explicit -conf flag it reads that instead of the conf/
# this repo (and docker-compose.yml's bind mount) actually ships.
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
# FreeSWITCH requires -conf/-log/-db to be specified together, or none at all.
CMD ["freeswitch", \
     "-conf", "/usr/local/freeswitch/conf", \
     "-log", "/usr/local/freeswitch/log", \
     "-db", "/usr/local/freeswitch/db", \
     "-u", "freeswitch", "-g", "freeswitch", "-nonat", "-nf"]
