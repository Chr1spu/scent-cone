# Scent Cone backend: FastAPI + WindNinja CLI (mass-conserving solver only).
#
# Stage 1 builds WindNinja from github.com/firelab/windninja without the Qt GUI or
# OpenFOAM (the momentum solver is never used), following scripts/build_deps_ubuntu_2204.sh.
FROM ubuntu:22.04 AS windninja
ARG WINDNINJA_REF=3.12.2
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential cmake git ca-certificates pkg-config \
        libboost-program-options-dev libboost-date-time-dev libboost-test-dev \
        libgdal-dev libnetcdf-dev libcurl4-gnutls-dev libshp-dev libfontconfig1-dev \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch ${WINDNINJA_REF} https://github.com/firelab/windninja.git /opt/src/windninja
WORKDIR /opt/src/windninja/build
RUN cmake -D SUPRESS_WARNINGS=ON -D NINJA_GUI=OFF -D NINJA_QTGUI=OFF -D NINJAFOAM=OFF \
          -D NINJA_CLI=ON -D PHONE_HOME_QUERIES=OFF -D CMAKE_BUILD_TYPE=Release .. \
    && make -j"$(nproc)" WindNinja_cli \
    && mkdir -p /opt/windninja/bin \
    && cp src/cli/WindNinja_cli /opt/windninja/bin/ 2>/dev/null || find . -name WindNinja_cli -type f -exec cp {} /opt/windninja/bin/ \;
RUN cp -r /opt/src/windninja/data /opt/windninja/data

# Stage 2: runtime
FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
        software-properties-common ca-certificates curl \
    && add-apt-repository -y ppa:deadsnakes/ppa \
    && apt-get update && apt-get install -y --no-install-recommends \
        python3.11 python3.11-venv \
        libgdal30 libnetcdf19 libboost-program-options1.74.0 libboost-date-time1.74.0 \
        libcurl3-gnutls libshp2 libgomp1 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=windninja /opt/windninja /opt/windninja
ENV PATH=/opt/windninja/bin:/opt/venv/bin:$PATH \
    WINDNINJA_DATA=/opt/windninja/data \
    WINDNINJA_CLI=/opt/windninja/bin/WindNinja_cli
RUN python3.11 -m venv /opt/venv
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY scripts ./scripts
RUN mkdir -p cache data
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
