"use strict";
// TODO: Test images, interaction with SVG, creation of stacking
// context/containing block, fixed backgrounds, specificity of SVG transform
// attribute, inheritance (computed values)
//
// FIXME: CSSMatrix seems not to be implemented by most UAs.
// https://www.w3.org/Bugs/Public/show_bug.cgi?id=15443
//
// Probably requires reftests: interaction with overflow
//
// Not for now: transitions, animations
var div = document.querySelector("#test");
var divWidth = 100, divHeight = 50;
// Arbitrarily chosen epsilon that makes browsers mostly pass with some extra
// breathing room, since the specs don't define rounding.
var epsilon = 1.5;
// Account for prefixing so that I can check whether browsers actually follow
// the spec.  Obviously, in any final version of the test, only the unprefixed
// property will be tested.
var prop = "transform" in div.style ? "transform"
	: "msTransform" in div.style ? "msTransform"
	: "MozTransform" in div.style ? "MozTransform"
	: "webkitTransform" in div.style ? "webkitTransform"
	: "OTransform" in div.style ? "OTransform"
	: undefined;
var hyphenatedProp = {
	transform: "transform",
	msTransform: "-ms-transform",
	MozTransform: "-moz-transform",
	webkitTransform: "-webkit-transform",
	OTransform: "-o-transform",
}[prop];
var percentagesAndLengths = [
	".0",
	"-53.7px", "-1px", "0.0px", "0.12px", "1px", "53.7px",
	"-50%", "0%", "0.12%",
	"1em", "1ex", "1in", "1cm", "1mm", "1pt", "1pc"];
var emPixels = parseFloat(getComputedStyle(div).fontSize);
div.style.fontSize = "1ex";
var exPixels = parseFloat(getComputedStyle(div).fontSize);
div.removeAttribute("style");

var switchStyles = document.querySelectorAll("style.switch");
[].forEach.call(switchStyles, function(style) { style.disabled = true });

/**
 * Accepts a string that's a CSS length or percentage, and returns a number of
 * pixels (not a string), or null if parsing fails.  For percentages to be
 * accepted, percentRef must not be undefined.
 */
function convertToPx(input, percentRef) {
	var match = /^([-+]?[0-9]+|[-+]?[0-9]*\.[0-9]+)(em|ex|in|cm|mm|pt|pc|px|%)?$/.exec(input);
	if (!match) {
		return null;
	}
	var amount = Number(match[1]);
	var unit = match[2];
	if (amount == 0) {
		return 0;
	}
	if (!unit) {
		return null;
	}
	if (unit == "%" && percentRef === undefined) {
		return null;
	}
	return amount * {
		em: emPixels,
		ex: exPixels,
		in: 72/0.75,
		cm: (1/2.54)*72/0.75,
		mm: (1/25.4)*72/0.75,
		pt: 1/0.75,
		pc: 12/0.75,
		px: 1,
		"%": percentRef/100,
	}[unit];
}

/**
 * Accepts a string that's a CSS angle, and returns a number of radians (not a
 * string), or null if parsing fails.
 */
function convertToRad(input) {
	var match = /^([-+]?[0-9]+|[-+]?[0-9]*\.[0-9]+)(deg|grad|rad|turn)$/.exec(input);
	if (!match) {
		return null;
	}
	var amount = Number(match[1]);
	var unit = match[2];
	return amount * {
		deg: Math.PI/180,
		grad: Math.PI/200,
		rad: 1,
		turn: 2*Math.PI,
	}[unit];
}

/**
 * Multiplies two 3x2 matrices.
 */
function mxmul32(A, B) {
	return [
		A[0]*B[0] + A[2]*B[1],
		A[1]*B[0] + A[3]*B[1],
		A[0]*B[2] + A[2]*B[3],
		A[1]*B[2] + A[3]*B[3],
		A[0]*B[4] + A[2]*B[5] + A[4],
		A[1]*B[4] + A[3]*B[5] + A[5]
	];
}

/**
 * Given a sixteen-element numeric array mx in column-major order, returns true
 * if it's equivalent to a six-element array (a 2D matrix), false otherwise.
 */
function is2dMatrix(mx) {
	// A smaller epsilon than we use elsewhere, because entries of around 1 in
	// matrices are to be expected.
	var e = 0.001;
	return Math.abs(mx[2]) < e
		&& Math.abs(mx[3]) < e
		&& Math.abs(mx[6]) < e
		&& Math.abs(mx[7]) < e
		&& Math.abs(mx[8]) < e
		&& Math.abs(mx[9]) < e
		&& Math.abs(mx[10] - 1) < e
		&& Math.abs(mx[11]) < e
		&& Math.abs(mx[14]) < e
		&& Math.abs(mx[15] - 1) < e;
}

/**
 * Returns true or false every time it's called.  It more or less alternates,
 * but actually has a period of 17, so it won't repeat with the same period as
 * other cyclic things (these are quite repetitive tests).
 */
function getUseCssom() {
	if (getUseCssom.counter === undefined) {
		getUseCssom.counter = 0;
	}
	getUseCssom.counter++;
	getUseCssom.counter %= 17;
	return Boolean(getUseCssom.counter % 2);
}

/**
 * Tests that style="transform: value" results in transformation by the matrix
 * mx, which may have either six or sixteen entries.  Checks both the computed
 * value and bounding box.
 */
function testTransform(value, mx) {
	// FIXME: The spec doesn't match browsers for serialization of the
	// transform property when it's unset or "none".
	// https://www.w3.org/Bugs/Public/show_bug.cgi?id=15471
	if (value != "none") {
		var useCssom = getUseCssom();
		test(function() {
			if (useCssom) {
				div.removeAttribute("style");
				div.style[prop] = value;
			} else {
				div.setAttribute("style", hyphenatedProp + ": " + value);
			}
			testTransformParsing(mx);
		}, "Computed value for transform: " + value
		+ " set via " + (useCssom ? "CSSOM" : "setAttribute()"));
	}
	testTransformedBoundary(value, mx);
}

/**
 * Tests that div's computed style for transform is "matrix(...)" or
 * "matrix3d(...)", as appropriate.  mx can have either six or sixteen entries,
 * but the required output format is the same regardless -- an sixteen-entry
 * matrix with zeroes and ones in the right places still has to be output in
 * the matrix() format.
 */
function testTransformParsing(mx) {
	if (mx.length == 6) {
		mx = [mx[0], mx[1], 0, 0, mx[2], mx[3], 0, 0, 0, 0, 1, 0, mx[4], mx[5], 0, 1];
	}
	// FIXME: We allow px optionally in the last two entries because Gecko
	// adds it while other engines don't, and the spec is unclear about
	// which behavior is correct:
	// https://www.w3.org/Bugs/Public/show_bug.cgi?id=15431
	var computed = getComputedStyle(div)[prop];
	if (is2dMatrix(mx)) {
		var re = /^matrix\(([^,]+), ([^,]+), ([^,]+), ([^,]+), ([^,]+?)(?:px)?, ([^,]+?)(?:px)?\)$/;
		assert_regexp_match(computed, re, "computed value has unexpected form for 2D matrix");
		var match = re.exec(computed);
		assert_approx_equals(Number(match[1]), mx[0], epsilon, "getComputedStyle matrix component 0");
		assert_approx_equals(Number(match[2]), mx[1], epsilon, "getComputedStyle matrix component 1");
		assert_approx_equals(Number(match[3]), mx[4], epsilon, "getComputedStyle matrix component 2");
		assert_approx_equals(Number(match[4]), mx[5], epsilon, "getComputedStyle matrix component 3");
		assert_approx_equals(Number(match[5]), mx[12], epsilon, "getComputedStyle matrix component 4");
		assert_approx_equals(Number(match[6]), mx[13], epsilon, "getComputedStyle matrix component 5");
		return;
	}

	var re = /^matrix\(([^,]+), ([^,]+), ([^,]+), ([^,]+), ([^,]+), ([^,]+), ([^,]+), ([^,]+), ([^,]+), ([^,]+), ([^,]+), ([^,]+), ([^,]+?)(?:px)?, ([^,]+?)(?:px)?, ([^,]+?)(?:px)?, ([^,]+?)\)$/;
	assert_regexp_match(computed, re, "computed value has unexpected form for 3D matrix");
	var match = re.exec(computed);
	for (var i = 0; i < 16; i++) {
		assert_approx_equals(Number(match[i + 1]), mx[i], epsilon,
			"getComputedStyle matrix component " + i);
	}
}

/**
 * Tests that
 *   style="transform: transformValue; transform-origin: transformOriginValue"
 * results in the boundary box that you'd get from transforming with a matrix
 * of mx around an offset of [xOffset, yOffset].  transformOriginValue defaults
 * to "50% 50%", xOffset to divWidth/2, yOffset to divHeight/2.
 *
 * transformValue can also be an array of three values.  If it is, they're used
 * for the test div's grandparent, its parent, and the test div itself,
 * respectively.  mx should then be the entries of the matrix of all three
 * transforms multiplied together.
 */
function testTransformedBoundary(transformValue, mx,
                                 transformOriginValue, xOffset, yOffset) {
	if (mx.length == 6) {
		mx = [mx[0], mx[1], 0, 0, mx[2], mx[3], 0, 0, 0, 0, 1, 0, mx[4], mx[5], 0, 1];
	}

	// Don't test singular matrices for now.  IE fails some of them, which
	// might be due to getBoundingClientRect() instead of transforms.  Only
	// skipped for 2D matrices, for sanity's sake.
	if (is2dMatrix(mx)
	&& mx[0]*mx[5] - mx[1]*mx[4] === 0) {
		return;
	}

	if (transformOriginValue === undefined) {
		transformOriginValue = "50% 50%";
	}
	if (xOffset === undefined) {
		xOffset = divWidth/2;
	}
	if (yOffset === undefined) {
		yOffset = divHeight/2;
	}

	// Compute the expected bounding box by applying the given matrix to the
	// vertices of the test div's border box.  We ignore the z components of
	// the result, and use the fact that the z component of the input is zero,
	// so this isn't complicated when the matrix is 3D.
	var originalPoints = [[0, 0], [0, divHeight], [divWidth, 0], [divWidth, divHeight]];
	var expectedTop, expectedRight, expectedBottom, expectedLeft;
	for (var i = 0; i < originalPoints.length; i++) {
		var newX = mx[0]*(originalPoints[i][0]-xOffset) + mx[4]*(originalPoints[i][1]-yOffset)
			+ mx[12] + xOffset;
		var newY = mx[1]*(originalPoints[i][0]-xOffset) + mx[5]*(originalPoints[i][1]-yOffset)
			+ mx[13] + yOffset;
		if (expectedTop === undefined || newY < expectedTop) {
			expectedTop = newY;
		}
		if (expectedRight === undefined || newX > expectedRight) {
			expectedRight = newX;
		}
		if (expectedBottom === undefined || newY > expectedBottom) {
			expectedBottom = newY;
		}
		if (expectedLeft === undefined || newX < expectedLeft) {
			expectedLeft = newX;
		}
	}

	// Pick a different <style class=switch> for each test; they shouldn't
	// affect results, so it's fine to just alternate.  We cycle through using
	// a reasonably large prime number (19) so that when the tests are
	// repetitive, we're unlikely to keep hitting the same styles for the same
	// sort of test.
	if (testTransformedBoundary.switchStyleIdx === undefined) {
		testTransformedBoundary.switchStyleIdx = switchStyles.length - 1;
	}
	switchStyles[testTransformedBoundary.switchStyleIdx % switchStyles.length].disabled = true;
	testTransformedBoundary.switchStyleIdx++;
	testTransformedBoundary.switchStyleIdx %= 19;
	switchStyles[testTransformedBoundary.switchStyleIdx % switchStyles.length].disabled = false;

	var useCssom = getUseCssom();
	if (typeof transformValue == "string") {
		test(function() {
			if (useCssom) {
				div.removeAttribute("style");
				div.style[prop] = transformValue;
				div.style[prop + "Origin"] = transformOriginValue;
			} else {
				div.setAttribute("style", hyphenatedProp + ": " + transformValue + "; "
					+ hyphenatedProp + "-origin: " + transformOriginValue);
			}
			testTransformedBoundaryAsserts(expectedTop, expectedRight, expectedBottom, expectedLeft);
		}, "Boundaries with \"transform: " + transformValue + "; "
		+ "transform-origin: " + transformOriginValue + "\" "
		+ "set via " + (useCssom ? "CSSOM" : "setAttribute()") + "; "
		+ "switch style " + (testTransformedBoundary.switchStyleIdx % switchStyles.length));
	} else {
		test(function() {
			if (useCssom) {
				div.parentNode.parentNode.style[prop] = transformValue[0];
				div.parentNode.style[prop] = transformValue[1];
				div.removeAttribute("style");
				div.style[prop] = transformValue[2];
				div.style[prop + "Origin"] = transformOriginValue;
			} else {
				div.parentNode.parentNode.setAttribute("style",
					hyphenatedProp + ": " + transformValue[0]);
				div.parentNode.setAttribute("style",
					hyphenatedProp + ": " + transformValue[1]);
				div.setAttribute("style",
					hyphenatedProp + ": " + transformValue[2] + "; "
					+ hyphenatedProp + "-origin: " + transformOriginValue);
			}
			testTransformedBoundaryAsserts(expectedTop, expectedRight, expectedBottom, expectedLeft);
		}, "Boundaries with \"transform: " + transformValue[0] + "\" on test div's grandparent, "
		+ "\"transform: " + transformValue[1] + "\" on its parent, "
		+ "\"transform: " + transformValue[2] + "; "
		+ "transform-origin: " + transformOriginValue + "\" on test div, "
		+ "set via " + (useCssom ? "CSSOM" : "setAttribute()") + "; "
		+ "switch style " + (testTransformedBoundary.switchStyleIdx % switchStyles.length));

		div.parentNode.removeAttribute("style");
		div.parentNode.parentNode.removeAttribute("style");
	}
}

function testTransformedBoundaryAsserts(expectedTop, expectedRight, expectedBottom, expectedLeft) {
	// FIXME: We assume getBoundingClientRect() returns the rectangle
	// that contains the transformed box, not the untransformed box.
	// This is not actually specified anywhere:
	// https://www.w3.org/Bugs/Public/show_bug.cgi?id=15430
	var rect = div.getBoundingClientRect();
	var msg = " (actual " + rect.top.toFixed(3) + ", "
		+ rect.right.toFixed(3) + ", "
		+ rect.bottom.toFixed(3) + ", "
		+ rect.left.toFixed(3) + "; "
		+ "expected " + expectedTop.toFixed(3) + ", "
		+ expectedRight.toFixed(3) + ", "
		+ expectedBottom.toFixed(3) + ", "
		+ expectedLeft.toFixed(3) + ")";
	assert_approx_equals(rect.top, expectedTop, epsilon, "top" + msg);
	assert_approx_equals(rect.right, expectedRight, epsilon, "right" + msg);
	assert_approx_equals(rect.bottom, expectedBottom, epsilon, "bottom" + msg);
	assert_approx_equals(rect.left, expectedLeft, epsilon, "left" + msg);
	assert_approx_equals(rect.width, expectedRight - expectedLeft, epsilon, "width" + msg);
	assert_approx_equals(rect.height, expectedBottom - expectedTop, epsilon, "height" + msg);
}

/**
 * Test that "transform-origin: value" acts like the origin is at
 * (expectedHoriz, expectedVert), where the latter two parameters can be
 * keywords, percentages, or lengths.  Tests both that the computed value is
 * correct, and that the boundary box is as expected for a 45-degree rotation.
 */
function testTransformOrigin(value, expectedHoriz, expectedVert) {
	if (expectedHoriz == "left") {
		expectedHoriz = "0%";
	} else if (expectedHoriz == "center") {
		expectedHoriz = "50%";
	} else if (expectedHoriz == "right") {
		expectedHoriz = "100%";
	}
	if (expectedVert == "top") {
		expectedVert = "0%";
	} else if (expectedVert == "center") {
		expectedVert = "50%";
	} else if (expectedVert == "bottom") {
		expectedVert = "100%";
	}
	// FIXME: Nothing defines resolved values here.  I picked the behavior of
	// all non-Gecko engines, which is also the behavior Gecko for transforms
	// other than "none": https://www.w3.org/Bugs/Public/show_bug.cgi?id=15433
	expectedHoriz = convertToPx(expectedHoriz, divWidth);
	expectedVert = convertToPx(expectedVert, divHeight);

	if (testTransformOrigin.counter === undefined) {
		testTransformOrigin.counter = 0;
	}
	// The transform doesn't matter here, so set it to one of several
	// possibilities arbitrarily (this actually catches a Gecko bug!)
	var transformValue = {
		0: "none",
		1: "matrix(7, 0, -1, 13, 0, 0)",
		2: "translate(4em, -15px)",
		3: "scale(1.2, 1)",
		4: "rotate(43deg)",
	}[testTransformOrigin.counter % 5];
	testTransformOrigin.counter++;
	div.removeAttribute("style");

	test(function() {
		div.style[prop] = transformValue;
		div.style[prop + "Origin"] = value;
		testTransformOriginParsing(expectedHoriz, expectedVert);
	}, "Computed value for transform-origin with transform: " + transformValue + "; transform-origin: " + value + " set via CSSOM");
	test(function() {
		div.setAttribute("style", hyphenatedProp + ": " + transformValue
			+ "; " + hyphenatedProp + "-origin:" + value);
		testTransformOriginParsing(expectedHoriz, expectedVert);
	}, "Computed value for transform-origin with transform: " + transformValue + "; transform-origin: " + value + " set via setAttribute()");

	// Test with a 45-degree rotation, since the effect of changing the origin
	// will be easy to understand.
	testTransformedBoundary(
		// Transform
		"rotate(45deg)",
		// Matrix entries
		[Math.cos(Math.PI/4), Math.sin(Math.PI/4),
		-Math.sin(Math.PI/4), Math.cos(Math.PI/4),
		0, 0],
		// Origin
		value, expectedHoriz, expectedVert
	);
}

/**
 * Tests that style="transform-origin: value" results in
 * getComputedStyle().transformOrigin being expectedHoriz + "px " + expectedVert + "px".
 */
function testTransformOriginParsing(expectedHoriz, expectedVert) {
	var actual = getComputedStyle(div)[prop + "Origin"];
	var re = /^([^ ]+)px ([^ ]+)px$/;
	assert_regexp_match(actual, re, "Computed value has unexpected form");
	var match = re.exec(actual);

	assert_approx_equals(Number(match[1]), expectedHoriz,
		epsilon, "Value of horizontal part (actual: "
			 + actual + ", expected " + expectedHoriz + "px " + expectedVert + "px)");

	assert_approx_equals(Number(match[2]), expectedVert,
		epsilon, "Value of vertical part (actual: "
			 + actual + ", expected " + expectedHoriz + "px " + expectedVert + "px)");
}
