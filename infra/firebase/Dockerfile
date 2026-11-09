FROM node:22-bookworm
RUN apt-get update \
  && apt-get install -y --no-install-recommends default-jre-headless \
  && npm install -g firebase-tools@14.9.0 \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /firebase
EXPOSE 9099
CMD ["firebase", "emulators:start", "--only", "auth", "--project", "zephyr-local"]
