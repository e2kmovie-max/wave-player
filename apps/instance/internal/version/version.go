package version

// Set at build time via -ldflags "-X github.com/.../version.Version=...".
// Defaults to "dev" so local `go run` works without flags.
var Version = "dev"
