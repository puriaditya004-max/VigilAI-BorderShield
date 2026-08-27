const imageArgIndex = process.argv.indexOf("--image");
if (imageArgIndex === -1 || !process.argv[imageArgIndex + 1]) {
  console.error("missing --image");
  process.exit(2);
}

const cropArgIndex = process.argv.indexOf("--crop");
const cropPath = cropArgIndex === -1 ? null : process.argv[cropArgIndex + 1];

console.log(JSON.stringify({
  plates: [
    {
      bbox: [80, 120, 210, 158],
      confidence: 0.87,
      quality: { sharpness: 0.32 },
      cropPath
    }
  ]
}));
