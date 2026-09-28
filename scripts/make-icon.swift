// Generates the dithered-bell app icon: swift scripts/make-icon.swift PushAlarm/Assets.xcassets/AppIcon.appiconset/AppIcon.png
import AppKit

let size = 1024, cell = 24, gap = 5
let blue = NSColor(srgbRed: 0.12, green: 0.36, blue: 1.0, alpha: 1)
let bayer: [Double] = [0,32,8,40,2,34,10,42,48,16,56,24,50,18,58,26,12,44,4,36,14,46,6,38,60,28,52,20,62,30,54,22,
                       3,35,11,43,1,33,9,41,51,19,59,27,49,17,57,25,15,47,7,39,13,45,5,37,63,31,55,23,61,29,53,21]

func bitmap() -> NSBitmapImageRep {
    NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4,
                     hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
}

// 1. Bell coverage mask.
let mask = bitmap()
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: mask)
let symbol = NSImage(systemSymbolName: "bell.fill", accessibilityDescription: nil)!
    .withSymbolConfiguration(.init(pointSize: 600, weight: .regular))!
let s = symbol.size
symbol.draw(in: NSRect(x: (Double(size) - s.width) / 2, y: (Double(size) - s.height) / 2, width: s.width, height: s.height))
NSGraphicsContext.restoreGraphicsState()

// 2. Ordered dither: dense bottom-left, fading toward top-right (same look as the app).
let out = bitmap()
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: out)
NSColor.white.setFill()
NSRect(x: 0, y: 0, width: size, height: size).fill()
blue.setFill()
for cy in 0..<(size / cell) {
    for cx in 0..<(size / cell) {
        let px = cx * cell + cell / 2, py = cy * cell + cell / 2          // py counts from the top
        let alpha = Double(mask.colorAt(x: px, y: py)?.alphaComponent ?? 0)
        guard alpha > 0 else { continue }
        let u = (Double(size - px) + Double(py)) / Double(2 * size)       // 0 top-right … 1 bottom-left
        let t = min(max((u - 0.3) / 0.4, 0), 1)                             // fit the gradient to the bell
        let ink = alpha * (0.38 + 0.7 * t)
        let threshold = (bayer[(cy % 8) * 8 + cx % 8] + 0.5) / 64
        if ink > threshold {
            NSRect(x: cx * cell, y: size - (cy + 1) * cell + gap, width: cell - gap, height: cell - gap).fill()
        }
    }
}
NSGraphicsContext.restoreGraphicsState()

// App Store icons must be opaque: flatten to RGB.
let cg = out.cgImage!
let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                    space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
ctx.draw(cg, in: CGRect(x: 0, y: 0, width: size, height: size))
let png = NSBitmapImageRep(cgImage: ctx.makeImage()!).representation(using: .png, properties: [:])!
try! png.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
