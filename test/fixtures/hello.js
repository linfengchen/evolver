// Prints "hello-sandbox" and cwd -- used by validator.test.js to verify
// sandbox isolation (cwd must be under os.tmpdir()).
console.log('hello-sandbox');
console.log(process.cwd());
