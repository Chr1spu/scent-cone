# Scent Cone backend: FastAPI + WindNinja CLI (mass-conserving solver only).
#
# WindNinja is built from github.com/firelab/windninja following
# scripts/build_deps_ubuntu_2404.sh, but without the Qt GUI or OpenFOAM
# (the momentum solver is never used), which keeps the build fast.
FROM ubuntu:24.04
ARG WINDNINJA_REF=4.0.0
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential cmake git ca-certificates pkg-config \
        libboost-program-options-dev libboost-date-time-dev libboost-test-dev \
        libgdal-dev libnetcdf-dev libcurl4-gnutls-dev libshp-dev libfontconfig1-dev \
        python3 python3-venv python3-pip \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 --branch ${WINDNINJA_REF} https://github.com/firelab/windninja.git /opt/src/windninja \
    && mkdir -p /opt/src/windninja/build && cd /opt/src/windninja/build \
    && cmake -D SUPRESS_WARNINGS=ON -D NINJA_GUI=OFF -D NINJAFOAM=OFF -D NINJA_CLI=ON \
             -D PHONE_HOME_QUERIES=OFF -D CMAKE_BUILD_TYPE=Release .. \
    && make -j"$(nproc)" \
    && make install && ldconfig \
    && mkdir -p /opt/windninja && cp -r /opt/src/windninja/data /opt/windninja/data \
    && rm -rf /opt/src/windninja/build

ENV WINDNINJA_DATA=/opt/windninja/data \
    PATH=/opt/venv/bin:/usr/local/bin:$PATH
RUN python3 -m venv /opt/venv
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY scripts ./scripts
COPY tests ./tests
COPY pytest.ini .
RUN mkdir -p cache data
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
