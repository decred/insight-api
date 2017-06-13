#DOCKER_IMAGE_TAG=decred/insight-api
FROM ubuntu:trusty

LABEL description="Insight API (Decred fork)"
LABEL version="1.0"
LABEL maintainer "peter@froggle.org"

ENV NODE_VERSION v0.10.40
ENV TERM linux
ENV USER insight

# create user
RUN adduser --disabled-password --gecos ''  $USER

# update base distro & install build tooling
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -qy build-essential python git curl

ENV HOME /home/$USER
ENV APPDIR $HOME/insight
ENV NVM_DIR $HOME/.nvm

RUN mkdir -p $APPDIR && chown $USER.$USER $APPDIR

USER $USER
WORKDIR $APPDIR

COPY . $APPDIR

# install & configure NodeJS
RUN git clone -q https://github.com/creationix/nvm.git ~/.nvm && cd ~/.nvm && git checkout -q `git describe --abbrev=0 --tags` && \
    . $NVM_DIR/nvm.sh && \
    nvm install $NODE_VERSION && \
    nvm use $NODE_VERSION && \
    cd $APPDIR && \
    npm install

EXPOSE 3004

ENV BITCOIND_USER user
ENV BITCOIND_PASS pass
ENV BITCOIND_HOST dcrd
ENV INSIGHT_NETWORK dcrdtestnet
ENV LOGGER_LEVEL debug
ENV INSIGHT_FORCE_RPC_SYNC 1
ENV PATH $HOME/.nvm/$NODE_VERSION/bin:$PATH

CMD [ "npm", "start" ]
