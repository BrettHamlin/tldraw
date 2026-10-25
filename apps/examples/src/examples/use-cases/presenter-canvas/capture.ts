import { getPointsFromDrawSegments, type Mat, type TLDrawShape } from 'tldraw'

export function captureDrawShape(shape: TLDrawShape, transform: Mat) {
	return getPointsFromDrawSegments(
		shape.props.segments,
		shape.props.scaleX,
		shape.props.scaleY
	).map((point) => {
		const page = transform.applyToPoint(point)
		return {
			x: page.x,
			y: page.y,
			// Native draw stores device pressure multiplied by 1.25; playback restores it.
			pressure: shape.props.isPen ? Math.max(0, Math.min(1, point.z / 1.25)) : 0.5,
		}
	})
}
