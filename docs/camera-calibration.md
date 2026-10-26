# Camera calibration

Calibration answers one question: for a point in the court, in metres, which
pixel does the camera show it at? `shuttle-replay` answers it with a linear
pinhole camera estimated from points that you located by hand. This page
explains the coordinate systems, the two matrices the tool computes, the exact
algorithm, and what the reported errors mean.

## Two coordinate systems

**Image coordinates** `(u, v)` are source-video pixels: `u` grows to the right,
`v` grows downwards.

**World coordinates** `(X, Y, Z)` are metres in a court frame fixed by the BWF
court dimensions
([`court.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/court.py#L1-L24)):

```text
      X = 0                X = 6.10
 Y = 0  +--------------------+   far baseline (outer edge)
        |                    |
        |                    |
 Y=6.70 |====== net =========|   net plane; posts 1.55 m, centre 1.524 m
        |                    |
        |                    |
Y=13.40 +--------------------+   near baseline (outer edge)

 Z is up; Z = 0 is the court surface.
```

Lines are 40 mm wide and calibration points use **line centres**: outer lines
at X = 0.02 / 6.08 and Y = 0.02 / 13.38, singles sidelines at X = 0.48 / 5.62,
short service lines at Y = 4.70 / 8.70, doubles long service lines at
Y = 0.78 / 12.62, centre line X = 3.05
([`court_lines`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/court.py#L27-L52)).
Entering an outer edge where a centre is expected shifts that point by 2 cm.

## Pinhole projection

A pinhole camera maps a world point to a pixel with a 3x4 matrix `P`:

```text
 [a]       [X]
 [b] = P * [Y]        u = a / c ,  v = b / c
 [c]       [Z]
           [1]
```

The division by `c` is perspective: far things look small. `P` combines where
the camera is and how it is rotated (the extrinsics) with its focal length and
image centre (the intrinsics). The project never splits `P` into those parts;
it uses `P` as one matrix
([`project`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/geometry.py#L12-L15)).
The camera centre `C` is the one point with `P * [C, 1] = 0`, so
`C = -inverse(P[:, :3]) * P[:, 3]`
([`camera_center`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/geometry.py#L24-L26)).

## Step 1: the floor homography (Z = 0 only)

For points on the floor, `Z = 0`, so the third column of `P` is multiplied by
zero and drops out:

```text
 P = [ p1  p2  p3  p4 ]          (four columns)
 floor point (X, Y, 0):  P * [X, Y, 0, 1] = [ p1 p2 p4 ] * [X, Y, 1] = H * [X, Y, 1]
```

The 3x3 matrix `H = [p1 p2 p4]` is a **homography**. It is fitted from your
`role: "fit"` ground points with the normalised direct linear transform (DLT) in
[`fit_homography`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L58-L78):

1. Each point set is translated to its centroid and scaled so its mean distance
   from the centroid is `sqrt(2)`
   ([`_normalize`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L36-L39)).
   This keeps the linear system well conditioned when pixel values are in the
   hundreds and metres are single digits.
2. Each correspondence adds two rows to a linear system `A h = 0`.
3. `h` is the right singular vector of `A` for the smallest singular value; the
   normalisation is undone and `H` is scaled so `H[2, 2] = 1`.

Degenerate inputs are rejected with `CalibrationError` instead of producing a
bad matrix: fewer than four fit points, duplicate coordinates, collinear point
sets, three collinear points out of exactly four, a second-smallest singular
value below `1e-9` times the largest (solution not unique), or a condition
number above `1e12`
([`_check_spread`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L42-L78)).

The fit is a normalised DLT minimising an algebraic residual on all fit
points, without nonlinear reprojection refinement. There is no outlier
rejection (no RANSAC) and no lens-distortion model: a mistyped point or strong
barrel distortion pulls the whole fit.

`H` only describes the floor. The output says so in `H_scope`
([`H_SCOPE`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L22)).
Back-projecting a shuttle pixel through `H` answers "where would this pixel be
if it were on the floor", which is wrong for anything in the air.

## Step 2: the vertical column from net anchors

The floor points say nothing about `p3`, the column that multiplies height.
That needs points of known height that are not on the floor: normally the two
net post tops at `Z = 1.55`. For an anchor at `(X, Y, Z)` seen at `(u, v)`,
write `q = H * [X, Y, 1]`. The projection condition becomes linear in `p3`:

```text
 u * (q3 + Z * p3_3) = q1 + Z * p3_1
 v * (q3 + Z * p3_3) = q2 + Z * p3_2

 rearranged per anchor:
   [ Z  0  -u*Z ] * p3 = u*q3 - q1
   [ 0  Z  -v*Z ] * p3 = v*q3 - q2
```

[`camera_from_anchors`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L81-L92)
stacks these rows, requires rank 3, solves by least squares and assembles
`P = [h1 h2 p3 h3]`, where `h1`, `h2`, `h3` are the columns of `H`. Three unknowns and two rows per anchor means two anchors
give four equations: almost exactly determined. That is why a small anchor
residual (`net_anchor_residuals_px`) proves little. Anchors must be elevated
(`Z > 0.1 m`) and there must be at least two.

Finally
[`_check_camera`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L95-L104)
rejects a camera whose centre is not above the floor, or one that would place
some court points in front of it and others behind it.

## Fit points versus held-out points

Every ground point has a role
([`calibrate_segment`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L128-L205)):

- `fit` points build `H`. Their residuals (`fit_ground_residuals`) are
  training error and are expected to be small.
- `heldout` points are never used for fitting. At least one is required.
  `heldout_ground_errors` reports, per point, `error_px` (`H` applied to the
  world point, compared with your pixel) and `error_m` (inverse `H` applied to
  your pixel, compared with the world point). `heldout_summary` gives the count,
  mean and max of both.

A conceptual example: four outer corners as `fit` and two service-line
intersections as `heldout`. If the held-out errors are much larger than the fit
residuals, a point is mislabelled, a line edge was clicked instead of its centre,
or the lens bends the lines. Held-out error is a check on the floor mapping
only; it says nothing about heights.

## Sensitivity, not a confidence interval

Heights depend almost entirely on the anchors.
[`_anchor_sensitivity`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L107-L125)
takes a reference point `(3.05, 6.70, 3.0)`, 3 m above the net centre line,
and projects it with `P`. Then, for each anchor and for `u` and `v` separately,
it moves the anchor pixel by `+uncertainty_px` and `-uncertainty_px` (default
3.0), re-solves `P`, and intersects the ray through the same reference pixel
with the net plane `Y = 6.70`. `max_vertical_shift_m` is the largest change in
height. If a perturbation makes the solve fail, the shift is reported as
infinity.

This is a one-at-a-time worst case for one point. It is not a statistical
confidence interval, does not combine errors from several anchors, and does not
include ground-point error.

## Assumptions you are making

- One fixed camera per `segment_id`; a camera move or zoom needs a new segment.
- Straight lines stay straight in the image (no lens distortion).
- The anchors have the heights you enter. Post tops at 1.55 m and the net centre
  at 1.524 m are different heights.
- The ground plane is not the shuttle. `H` gives floor positions; shuttle depth
  comes only from the physics fit described in
  [Trajectory physics](trajectory-physics.md).

See [the schemas](schemas.md) for the full input and output fields and
[Validation and limits](validation-limits.md) for how to read the errors
together with the flight diagnostics.
