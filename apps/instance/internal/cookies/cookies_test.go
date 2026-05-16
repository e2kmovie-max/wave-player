package cookies

import (
	"os"
	"strings"
	"testing"
)

func TestWrite_EmptySliceReturnsNilFile(t *testing.T) {
	f, err := Write(nil)
	if err != nil {
		t.Fatalf("Write nil: %v", err)
	}
	if f != nil {
		t.Fatalf("expected nil file for nil cookies, got %+v", f)
	}
	f, err = Write([]Cookie{})
	if err != nil {
		t.Fatalf("Write empty: %v", err)
	}
	if f != nil {
		t.Fatalf("expected nil file for empty cookies, got %+v", f)
	}
}

func TestWrite_ProducesNetscapeLines(t *testing.T) {
	f, err := Write([]Cookie{
		{Name: "SID", Value: "abc", Domain: ".youtube.com", Path: "/", Secure: true, Expires: 1888888888},
		{Name: "PREF", Value: "f1=10000000", Domain: "youtube.com", Path: "/", Expires: 0},
	})
	if err != nil {
		t.Fatalf("Write: %v", err)
	}
	if f == nil {
		t.Fatal("expected non-nil file")
	}
	defer f.Remove()

	info, err := os.Stat(f.Path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("file permissions = %o, want 600", info.Mode().Perm())
	}

	body, err := os.ReadFile(f.Path)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	got := string(body)

	for _, want := range []string{
		"# Netscape HTTP Cookie File",
		".youtube.com\tTRUE\t/\tTRUE\t1888888888\tSID\tabc",
		"youtube.com\tFALSE\t/\tFALSE\t0\tPREF\tf1=10000000",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("missing line: %q\nfull file:\n%s", want, got)
		}
	}
}

func TestWrite_RemoveDeletesFile(t *testing.T) {
	f, err := Write([]Cookie{{Name: "x", Value: "y", Domain: ".example.com", Path: "/"}})
	if err != nil {
		t.Fatalf("Write: %v", err)
	}
	path := f.Path
	f.Remove()
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("expected file removed, stat err = %v", err)
	}
}

func TestWrite_RejectsTabInjection(t *testing.T) {
	_, err := Write([]Cookie{{Name: "x\ty", Value: "v", Domain: ".example.com", Path: "/"}})
	if err == nil {
		t.Fatal("expected rejection of tab in cookie name")
	}
	_, err = Write([]Cookie{{Name: "x", Value: "v\nz", Domain: ".example.com", Path: "/"}})
	if err == nil {
		t.Fatal("expected rejection of newline in cookie value")
	}
}

func TestWrite_RejectsMissingFields(t *testing.T) {
	if _, err := Write([]Cookie{{Value: "v", Domain: ".example.com"}}); err == nil {
		t.Fatal("expected rejection of empty name")
	}
	if _, err := Write([]Cookie{{Name: "n", Value: "v"}}); err == nil {
		t.Fatal("expected rejection of empty domain")
	}
}
