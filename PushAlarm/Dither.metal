#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// 8x8 Bayer matrix for ordered dithering.
constant float bayer8[64] = {
     0, 32,  8, 40,  2, 34, 10, 42,
    48, 16, 56, 24, 50, 18, 58, 26,
    12, 44,  4, 36, 14, 46,  6, 38,
    60, 28, 52, 20, 62, 30, 54, 22,
     3, 35, 11, 43,  1, 33,  9, 41,
    51, 19, 59, 27, 49, 17, 57, 25,
    15, 47,  7, 39, 13, 45,  5, 37,
    63, 31, 55, 23, 61, 29, 53, 21
};

/// Turns the layer into a grid of square dots.
/// The layer's alpha is the "ink" amount: a cell gets a dot when its alpha beats the Bayer threshold.
/// `time` sweeps a soft diagonal wave through the ink so the pattern shimmers.
[[ stitchable ]] half4 dither(float2 position, SwiftUI::Layer layer, float cell, float gap, half4 tint, float time) {
    float2 index = floor(position / cell);
    float coverage = layer.sample((index + 0.5) * cell).a;
    if (coverage <= 0.0) return half4(0);

    float wave = sin((index.x - index.y) * 0.16 - time * 0.8) * 0.5
               + sin(index.y * 0.09 + time * 0.5) * 0.5;
    coverage = clamp(coverage + wave * 0.22, 0.0, 1.0);

    uint2 b = uint2(index) % 8;
    float threshold = (bayer8[b.y * 8 + b.x] + 0.5) / 64.0;
    if (coverage <= threshold) return half4(0);

    float2 local = position - index * cell;
    if (local.x >= cell - gap || local.y >= cell - gap) return half4(0);
    return tint;
}
