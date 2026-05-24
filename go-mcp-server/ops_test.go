package main

import "testing"

func TestComparators(t *testing.T) {
	cases := []struct {
		op       string
		lhs, rhs float64
		want     bool
	}{
		// The worked example from the spec: 12 GT 14 -> false.
		{"gt", 12, 14, false},
		{"gt", 14, 12, true},
		{"gt", 12, 12, false},

		{"lt", 12, 14, true},
		{"lt", 14, 12, false},
		{"lt", 12, 12, false},

		{"gte", 12, 12, true},
		{"gte", 14, 12, true},
		{"gte", 12, 14, false},

		{"lte", 12, 12, true},
		{"lte", 12, 14, true},
		{"lte", 14, 12, false},

		{"eq", 12, 12, true},
		{"eq", 12, 14, false},

		{"neq", 12, 14, true},
		{"neq", 12, 12, false},
	}

	for _, c := range cases {
		got, err := Evaluate(c.op, c.lhs, c.rhs)
		if err != nil {
			t.Fatalf("Evaluate(%q, %v, %v) returned error: %v", c.op, c.lhs, c.rhs, err)
		}
		if got != c.want {
			t.Errorf("Evaluate(%q, %v, %v) = %v, want %v", c.op, c.lhs, c.rhs, got, c.want)
		}
	}
}

func TestUnknownComparator(t *testing.T) {
	if _, err := Evaluate("xor", 1, 2); err == nil {
		t.Fatal("expected an error for an unknown comparator, got nil")
	}
}

// TestCatalogMatchesEvaluate ensures the advertised tool list never drifts
// away from what Evaluate can actually resolve.
func TestCatalogMatchesEvaluate(t *testing.T) {
	for _, m := range ComparatorCatalog {
		if _, err := Evaluate(m.Name, 1, 1); err != nil {
			t.Errorf("catalog tool %q is advertised but not handled by Evaluate: %v", m.Name, err)
		}
	}
}
