# Codenotch Monitor — build / test / install / package

SHELL := /bin/bash
DAEMON_DIR := daemon
DAEMON_BIN := $(DAEMON_DIR)/target/release/sparkline-daemon
EXT_DIR := extension
DIST_DIR := build/dist
ZIP_NAME := sparkline-monitor@local.shell-extension.zip

.PHONY: build test install dist dist-dir clean help

build:
	cargo build --release --manifest-path $(DAEMON_DIR)/Cargo.toml
	@echo "[+] Built $(DAEMON_BIN)"

test:
	cargo test --release --manifest-path $(DAEMON_DIR)/Cargo.toml

install: build
	./install.sh

dist: build dist-dir
	cp $(EXT_DIR)/metadata.json $(DIST_DIR)/
	cp $(EXT_DIR)/extension.js $(DIST_DIR)/
	cp $(EXT_DIR)/ring_gauge.js $(DIST_DIR)/
	cp $(EXT_DIR)/sparkline.js $(DIST_DIR)/
	cp $(EXT_DIR)/stylesheet.css $(DIST_DIR)/
	mkdir -p $(DIST_DIR)/schemas
	cp $(EXT_DIR)/schemas/*.xml $(DIST_DIR)/schemas/
	(cd $(DIST_DIR) && zip -qr ../$(ZIP_NAME) .)
	@echo "[+] Created $(ZIP_NAME)"

dist-dir:
	mkdir -p $(DIST_DIR)

clean:
	rm -rf build $(DAEMON_DIR)/target

help:
	@echo "Targets: build (Rust release), test (cargo test), install, dist (extension zip), clean"