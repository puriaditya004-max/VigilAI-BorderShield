const imageArgIndex = process.argv.indexOf("--image");
if (imageArgIndex === -1 || !process.argv[imageArgIndex + 1]) {
  console.error("missing --image");
  process.exit(2);
}

console.log(JSON.stringify({
  results: [
    { text: "MH 12 AB 1234", confidence: 0.91 },
    { text: "MH12AB1234", confidence: 0.88 },
    { text: "MH-12-AB-1234", confidence: 0.9 }
  ]
}));
