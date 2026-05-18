package streamer

import (
	"errors"
	"net"
	"net/url"
	"strings"
)

// AllowPrivateTargets controls whether [ValidateSourceURL] accepts hostnames
// that resolve only to private / loopback / link-local addresses. Production
// instances should leave this at false; tests and local development can flip
// it to true via the WAVE_ALLOW_PRIVATE_TARGETS env var (wired in cmd/instance).
//
// We resolve the hostname when the literal is an IP — true SSRF protection
// against DNS rebinding would require resolving on every actual outbound
// request inside yt-dlp/ffmpeg, which we cannot easily do without intercepting
// the network layer. The bar this check enforces is: "do not let a caller
// trivially aim yt-dlp at a metadata service / private RFC1918 host by typing
// http://169.254.169.254 or http://localhost into the URL field".
var AllowPrivateTargets = false

// ErrURLEmpty is returned when the caller did not supply a URL.
var ErrURLEmpty = errors.New("url is required")

// ErrURLScheme is returned when the URL is not http(s).
var ErrURLScheme = errors.New("url must be http(s)")

// ErrURLPrivateTarget is returned when the URL points at a non-routable host
// (loopback, link-local, RFC1918, ULA, multicast) and AllowPrivateTargets is
// false.
var ErrURLPrivateTarget = errors.New("url points at a private host")

// ValidateSourceURL parses the request URL and rejects anything that would
// let a master/caller weaponise our instance: non-http schemes (file://,
// data:, gopher://, ssh://…) or hosts that point back at our own network.
//
// The check is intentionally cheap and synchronous: it does not perform DNS
// resolution. yt-dlp itself will refuse to fetch from most weird schemes, but
// catching them here turns an otherwise opaque "yt-dlp failed" log into a
// clean 400 the master can record without burning a cookie rotation.
func ValidateSourceURL(raw string) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ErrURLEmpty
	}
	u, err := url.Parse(raw)
	if err != nil {
		return errors.Join(ErrURLScheme, err)
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "http" && scheme != "https" {
		return ErrURLScheme
	}
	host := u.Hostname()
	if host == "" {
		return ErrURLScheme
	}
	if AllowPrivateTargets {
		return nil
	}
	if isPrivateHost(host) {
		return ErrURLPrivateTarget
	}
	return nil
}

// isPrivateHost returns true when host is a textual IP that lives in a range
// we never want to expose, or when it is one of the "localhost" sentinels.
// Hostnames that need DNS resolution to classify are *allowed* — DNS is the
// caller's responsibility and yt-dlp already enforces transport security.
func isPrivateHost(host string) bool {
	lower := strings.ToLower(host)
	switch lower {
	case "localhost", "ip6-localhost", "ip6-loopback":
		return true
	}
	// Strip an IPv6 zone suffix (e.g. "fe80::1%eth0") which net.ParseIP rejects.
	if i := strings.IndexByte(lower, '%'); i >= 0 {
		lower = lower[:i]
	}
	ip := net.ParseIP(lower)
	if ip == nil {
		return false
	}
	if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsInterfaceLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() {
		return true
	}
	if ip.IsPrivate() {
		return true
	}
	// IPv4 cloud metadata endpoint (defence in depth — IsPrivate covers
	// 169.254.0.0/16 via IsLinkLocalUnicast already, but being explicit makes
	// the intent obvious to anyone reading the code).
	if v4 := ip.To4(); v4 != nil && v4[0] == 169 && v4[1] == 254 {
		return true
	}
	return false
}
