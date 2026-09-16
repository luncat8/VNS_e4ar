# Findings and pitfalls

- A transformed or filtered ancestor becomes the containing block for `position:fixed` descendants. Never apply `transform` or `filter` to the wagon container (`#story`); theme effects belong on text descendants or independent overlays.
- Lateral exits cannot use one horizontal pixel per vertical collision pixel for arbitrary wagon sizes. Normalise collision penetration to 0…1 and map that to the complete exit distance, or small right-moving wagons remain visible for later wagons to push again.
- Keep the fixed/absolute background element out of flow in both engine states. Disabling movement should switch it to an absolute decoration at its anchor, not restore an ordinary block between text lines.
