{
  description = "TermKit development shell";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      formatter = forAllSystems (system: nixpkgs.legacyPackages.${system}.nixfmt);

      devShells = forAllSystems (
        system:
        let
          pkgs = import nixpkgs {
            inherit system;
          };
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_24
              pkgs.chromium
              pkgs.docker-compose
              pkgs.git
              pkgs.tigervnc
            ];

            PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
            PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = "${pkgs.chromium}/bin/chromium";

            shellHook = ''
              export TERMKIT_DOCKER_DNS_PRIMARY="1.1.1.1"
              export TERMKIT_DOCKER_DNS_SECONDARY="8.8.8.8"
              export TERMKIT_COMPOSE_DNS_OVERRIDE="$(${pkgs.coreutils}/bin/mktemp -t termkit-compose-dns.XXXXXX.yaml)"

              cat > "$TERMKIT_COMPOSE_DNS_OVERRIDE" <<'TERMKIT_COMPOSE_DNS_EOF'
              services:
                app:
                  build:
                    network: host
                  dns:
                    - 1.1.1.1
                    - 8.8.8.8
                migrate:
                  build:
                    network: host
                  dns:
                    - 1.1.1.1
                    - 8.8.8.8
                postgres:
                  dns:
                    - 1.1.1.1
                    - 8.8.8.8
                gateway:
                  dns:
                    - 1.1.1.1
                    - 8.8.8.8
              TERMKIT_COMPOSE_DNS_EOF

              if [ -f "$PWD/compose.yaml" ]; then
                if [ -n "''${COMPOSE_FILE:-}" ]; then
                  export COMPOSE_FILE="$COMPOSE_FILE:$TERMKIT_COMPOSE_DNS_OVERRIDE"
                else
                  export COMPOSE_FILE="$PWD/compose.yaml:$TERMKIT_COMPOSE_DNS_OVERRIDE"
                fi
              fi

              echo "TermKit dev shell: npm, Chromium, and Docker Compose are available."
              echo "Docker Compose DNS override: $TERMKIT_DOCKER_DNS_PRIMARY, $TERMKIT_DOCKER_DNS_SECONDARY."
            '';
          };
        }
      );
    };
}
