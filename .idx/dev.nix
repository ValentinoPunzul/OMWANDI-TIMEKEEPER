# To learn more about how to use Nix to configure your environment
# see: https://firebase.google.com/docs/studio/customize-workspace
{ pkgs, ... }: {
  # Which nixpkgs channel to use.
  channel = "stable-24.05"; # or "unstable"

  # Use https://search.nixos.org/packages to find packages
  packages = [
    pkgs.nodejs_20
    pkgs.npm-check-updates
  ];

  # Sets environment variables in the workspace
  env = {};
  idx = {
    # Search for the extensions you want on https://open-vsx.org/ and use "publisher.id"
    extensions = [
      "christian-kohler.path-intellisense"
      "dbaeumer.vscode-eslint"
    ];

    # Enable previews
    previews = {
      enable = true;
      previews = {
        web = {
          command = ["npm" "run" "start" "--" "--port" "$PORT" "--host" "0.0.0.0"];
          manager = "web";
          env = {
            PORT = "$PORT";
          };
        };
      };
    };

    # Workspace lifecycle hooks
    workspace = {
      # Runs when a workspace is first created
      onCreate = {
        npm-install = "npm install";
        # Open the relevant files for the user
        default.openFiles = [ "public/app.js" "server.js" "public/index.html" ];
      };
      # Runs when the workspace is (re)started
      onStart = {
      };
    };
  };
}
