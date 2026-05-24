package main

import "fmt"

// Operands carries the two values that every boolean comparator works over.
// lhs and rhs are the left- and right-hand sides of a single symbolic pair.
type Operands struct {
	LHS float64 `json:"lhs"`
	RHS float64 `json:"rhs"`
}

// Each comparator below is implemented imperatively: an explicit branch that
// returns true or false. They are deliberately tiny and total (no panics, no
// errors) so the only failure mode at the protocol layer is an unknown
// operator name, handled in Evaluate.

// GreaterThan reports whether lhs is strictly greater than rhs (GT).
func GreaterThan(lhs, rhs float64) bool {
	if lhs > rhs {
		return true
	}
	return false
}

// LessThan reports whether lhs is strictly less than rhs (LT).
func LessThan(lhs, rhs float64) bool {
	if lhs < rhs {
		return true
	}
	return false
}

// GreaterThanOrEqual reports whether lhs is greater than or equal to rhs (GTE).
func GreaterThanOrEqual(lhs, rhs float64) bool {
	if lhs >= rhs {
		return true
	}
	return false
}

// LessThanOrEqual reports whether lhs is less than or equal to rhs (LTE).
func LessThanOrEqual(lhs, rhs float64) bool {
	if lhs <= rhs {
		return true
	}
	return false
}

// Equal reports whether lhs equals rhs (EQ).
func Equal(lhs, rhs float64) bool {
	if lhs == rhs {
		return true
	}
	return false
}

// NotEqual reports whether lhs differs from rhs (NEQ).
func NotEqual(lhs, rhs float64) bool {
	if lhs != rhs {
		return true
	}
	return false
}

// Evaluate dispatches a comparator by its canonical tool name. The switch is
// the single source of truth for which operators the server can resolve.
func Evaluate(operator string, lhs, rhs float64) (bool, error) {
	switch operator {
	case "gt":
		return GreaterThan(lhs, rhs), nil
	case "lt":
		return LessThan(lhs, rhs), nil
	case "gte":
		return GreaterThanOrEqual(lhs, rhs), nil
	case "lte":
		return LessThanOrEqual(lhs, rhs), nil
	case "eq":
		return Equal(lhs, rhs), nil
	case "neq":
		return NotEqual(lhs, rhs), nil
	default:
		return false, fmt.Errorf("unknown comparator %q", operator)
	}
}

// ComparatorMeta describes one comparator for the tools/list response.
type ComparatorMeta struct {
	Name        string
	Description string
}

// ComparatorCatalog is the advertised set of comparator tools. Every entry
// here must be handled by Evaluate; TestCatalogMatchesEvaluate guards that.
var ComparatorCatalog = []ComparatorMeta{
	{"gt", "Greater than. Returns true when lhs > rhs."},
	{"lt", "Less than. Returns true when lhs < rhs."},
	{"gte", "Greater than or equal. Returns true when lhs >= rhs."},
	{"lte", "Less than or equal. Returns true when lhs <= rhs."},
	{"eq", "Equal. Returns true when lhs == rhs."},
	{"neq", "Not equal. Returns true when lhs != rhs."},
}
