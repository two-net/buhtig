# BuhTig's image holds its release binary and nothing else. Build the binary first, as the
# README says, with the UI embedded, on Linux with glibc 2.41 or older, as on Debian 13.
# CI builds it on Ubuntu 24.04.
#
# Mount the config file at /etc/buhtig/config.toml, readable by user 65532, as whom
# BuhTig runs:
#
#   docker run -p 8080:8080 -v ./config.toml:/etc/buhtig/config.toml:ro buhtig
#
# BuhTig listens on 0.0.0.0:8080 unless server.listen says otherwise.

# Debian 13 with glibc and libgcc, and no shell.
FROM gcr.io/distroless/cc-debian13:nonroot
COPY src/BuhTig/target/release/BuhTig /usr/local/bin/BuhTig
WORKDIR /etc/buhtig
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/BuhTig"]
