'use strict';

const co = require('co');
const assert = require('chai').assert;

class Agent {
    constructor() {
        this.called = 0;
    }
    __replaceStack(fn) {
        this.e = new Error();
        this.assert = function() {
            try {
                fn();
            } catch (e) {
                let firstLine = e.stack.replace(/\n[\s\S]*$/, '');
                let otherLines = this.e.stack.replace(/^.*?\n/, '');
                e.stack = `${firstLine}\n${otherLines}`;
                throw e;
            }
        }
    }
    atLeast(count, msg) {
        this.__replaceStack(() => assert.isAtLeast(this.called, count, msg));
    }
}

class LineNumDetector {
    constructor(filename) {
        this.filename = filename;
    }

    /**
     * @param {int} plus
     * @param {string} [stack]
     * @return {int}
     */
    line(plus, stack) {
        stack = stack || new Error().stack.replace(/ at __line .*?\n/, '');
        //console.log(stack);
        let regexp = new RegExp(`[ (]${this.filename.replace(/\\/g, '\\\\').replace(/\//g, '\\/')}:(\\d+):`);
        let matches = stack.match(regexp);
        if (matches && matches[1]) {
            return parseInt(matches[1]) + plus;
        } else {
            throw new Error(`行番号が取得できませんでした\nmatch(${regexp})\n取得を試みたstack: ${stack}`);
        }
    };
}

class GetThrownRes {
    constructor(e) {
        this.e = e;
    }

    /**
     * @param {RegExp|string} errMsgMatcher
     * @param {string} [message]
     * @return {GetThrownRes}
     */
    assertThrows(errMsgMatcher, message) {
        let e = (this.e.stack ? this.e : new Error(this.e));
        assert.throws(() => { throw e; }, null, errMsgMatcher, message);
        return this;
    }

    /**
     * @param {string} filename
     * @param {array} opt
     * @param {int} opt.line
     * @param {string} [message]
     * @return {GetThrownRes}
     */
    assertExistsInStack(filename, opt, message) {
        let e = (this.e.stack ? this.e : new Error(this.e));
        let lineNumDetector = new LineNumDetector(filename);
        assert.equal(lineNumDetector.line(0, e.stack), lineNumDetector.line(opt.line), message || '呼び出し元の行番号が取れる');
        return this;
    }
}

class CoMocha {
    /**
     * @callback CoMocha~wrapGenerator
     * @param {function} spy
     */

    /**
     * @param {CoMocha~wrapGenerator} generator
     * @return {function}
     */
    wrap(generator) {
        let agents = [];
        let spy = function (obj, method) {
            let agent = new Agent();
            let orig = obj[method];
            obj[method] = function () {
                agent.called++;
                return orig.apply(this, arguments);
            };
            agents.push(agent);
            return agent;
        };
        return function (done) {
            // noinspection JSUnresolvedFunction
            co(function * () {
                yield generator(spy);
                agents.filter(agent => agent).forEach(agent => {
                    agent.assert()
                });
                done();
            }).catch(function (e) {
                console.error(e);
                done(e);
            });
        };
    };

    /**
     * @param fn
     * @return {GetThrownRes}
     */
    * catchThrown(fn) {
        try {
            yield fn();
            return new GetThrownRes('エラー発生しなかった！');
        } catch (e) {
            return new GetThrownRes(e);
        }
    }
}

/**
 * @param {string} filename
 * @return {CoMocha}
 */
module.exports = new CoMocha();
