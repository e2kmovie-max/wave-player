package streamer

import (
	"strings"
	"testing"
)

func TestValidateSourceURL_AcceptsPublicHTTP(t *testing.T) {
	for _, u := range []string{
		"http://example.com/video.mp4",
		"https://www.youtube.com/watch?v=dQw4w9WgXcQ",
		"https://twitch.tv/somechannel",
		"https://9.9.9.9/r.m3u8", // a public DNS resolver — IP literal is fine
	} {
		if err := ValidateSourceURL(u); err != nil {
			t.Errorf("ValidateSourceURL(%q) = %v, want nil", u, err)
		}
	}
}

func TestValidateSourceURL_RejectsNonHTTP(t *testing.T) {
	for _, u := range []string{
		"",
		"   ",
		"file:///etc/passwd",
		"ftp://example.com",
		"javascript:alert(1)",
		"data:text/plain,hi",
		"gopher://example.com/",
	} {
		err := ValidateSourceURL(u)
		if err == nil {
			t.Errorf("ValidateSourceURL(%q) = nil, want error", u)
		}
	}
}

func TestValidateSourceURL_RejectsPrivateTargets(t *testing.T) {
	prev := AllowPrivateTargets
	AllowPrivateTargets = false
	t.Cleanup(func() { AllowPrivateTargets = prev })

	for _, u := range []string{
		"http://localhost/foo",
		"http://127.0.0.1:8080/info",
		"http://10.0.0.1/feed",
		"http://192.168.1.50/r.m3u8",
		"http://172.16.5.1/foo",
		"http://169.254.169.254/latest/meta-data/",
		"http://[::1]/x",
		"http://[fc00::1]/x",
		"http://[fe80::1]/x",
		"http://0.0.0.0/x",
		"http://239.255.255.250/x", // SSDP multicast
	} {
		err := ValidateSourceURL(u)
		if err == nil {
			t.Errorf("ValidateSourceURL(%q) = nil, want ErrURLPrivateTarget", u)
			continue
		}
		if !strings.Contains(err.Error(), "private") && !strings.Contains(err.Error(), "url") {
			t.Errorf("ValidateSourceURL(%q) returned unexpected error: %v", u, err)
		}
	}
}

func TestValidateSourceURL_OptInPrivate(t *testing.T) {
	prev := AllowPrivateTargets
	AllowPrivateTargets = true
	t.Cleanup(func() { AllowPrivateTargets = prev })

	if err := ValidateSourceURL("http://127.0.0.1:8080/x"); err != nil {
		t.Fatalf("with AllowPrivateTargets=true: %v", err)
	}
}

func TestIsTwitchURL(t *testing.T) {
	for _, c := range []struct {
		in   string
		want bool
	}{
		{"https://twitch.tv/somechannel", true},
		{"https://www.twitch.tv/somechannel", true},
		{"https://clips.twitch.tv/abc", true},
		{"https://m.twitch.tv/some", true},
		{"https://twitch.tv.evil.com/foo", false},
		{"https://www.youtube.com/watch?v=abc", false},
		{"", false},
		{"not-a-url", false},
	} {
		if got := IsTwitchURL(c.in); got != c.want {
			t.Errorf("IsTwitchURL(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}
