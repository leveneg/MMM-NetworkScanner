const Module = require("../node_helper.js");

const helper = new Module();

helper.setName("MMM-NetworkScanner");

// exampleOkTest
exports.exampleOkTest = test => {
    test.expect(1);
    test.ok(true, "should always return true");
    test.done();
};

// exampleEqualsTest
exports.exampleEqualsTest = test => {
    test.expect(1);
    test.equals(1, 1, "should always equal 1");
    test.done();
};
