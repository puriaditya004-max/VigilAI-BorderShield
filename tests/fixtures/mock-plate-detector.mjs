const imageArgIndex = process.argv.indexOf("--image");
if (imageArgIndex === -1 || !process.argv[imageArgIndex + 1]) {
  console.error("missing --image");
  process.exit(2);
}

console.log(JSON.stringify({
  plates: [
    {
      bbox: [80, 120, 210, 158],
      confidence: 0.87,
      quality: { sharpness: 0.32 }
    }
  ]
}));
