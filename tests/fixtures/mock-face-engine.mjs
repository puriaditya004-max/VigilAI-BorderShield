const imageArgIndex = process.argv.indexOf("--image");
if (imageArgIndex === -1 || !process.argv[imageArgIndex + 1]) {
  console.error("missing --image");
  process.exit(2);
}

console.log(JSON.stringify({
  faces: [
    { bbox: [12, 18, 64, 82], confidence: 0.86 }
  ]
}));
