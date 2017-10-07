'use strict';

const mysql = require('mysql');
const co = require('co');

class CoMySQL {
    constructor(configMYSQL) {
        this._pool = mysql.createPoolCluster();
        this._pool.add('MASTER', Object.assign({}, configMYSQL['COMMON'], configMYSQL['MASTER']));
        if (configMYSQL['SLAVES']) {
            configMYSQL['SLAVES'].forEach((slave, i) => {
                this._pool.add(`SLAVE${i + 1}`, Object.assign({}, configMYSQL['COMMON'], slave));
            });
        }
    }

    /**
     * @callback CoMySQL~onConnect
     * @param {CoMySQLConnection} conn
     * @return {Promise}
     */

    /**
     * @param {PoolNamespace} pool
     * @param {CoMySQL~onConnect} onConnect
     * @param {boolean} transaction
     * @return {Promise}
     */
    __getConnection(pool, onConnect, transaction) {
        let stacktrace = new Stacktrace(); //呼び出し元追跡用
        return new Promise((resolve, reject) => {
            pool.getConnection((err, origConn) => {
                [err, origConn] = this.__rewriteResOfGetConn(err, origConn); //テスト用
                if (err) {
                    return reject(stacktrace.error(err));
                }
                let conn = new CoMySQLConnection(origConn);
                const __coOnConnect = (onSuccess, onFail) => {
                    // noinspection JSUnresolvedFunction
                    co(function * () {
                        yield onConnect(conn);
                        onSuccess(function done() {
                            origConn.release();
                            return resolve(true);
                        });
                    }).catch(function (err) {
                        onFail(function done() {
                            origConn.release();
                            if (err === '__CoMySQL__rollback__') {
                                return resolve(false);
                            } else {
                                return reject(stacktrace.error(err));
                            }
                        });
                    });
                };
                if (transaction) {
                    origConn.beginTransaction(function (err) {
                        if (err) {
                            origConn.release();
                            return reject(stacktrace.error(err));
                        }
                        __coOnConnect(function onSuccess(done) {
                            origConn.commit((err) => {
                                if (err) {
                                    origConn.rollback();
                                    throw err;
                                }
                                done();
                            });
                        }, function onFail(done) {
                            origConn.rollback(() => {
                                done();
                            });
                        });
                    });
                } else {
                    __coOnConnect(function onSuccess(done) {
                        done();
                    }, function onFail(done) {
                        done();
                    });
                }
            });
        });
    }

    __rewriteResOfGetConn(err, conn) {
        return [err, conn];
    }

    _getPoolOf(clusterName, strategy) {
        return this._pool.of(clusterName, strategy);
    }

    /**
     * @param {CoMySQL~onConnect} onConnect
     * @return {Promise}
     */
    getMasterConnection(onConnect) {
        let pool = this._getPoolOf('MASTER');
        return this.__getConnection(pool, onConnect, false);
    }

    /**
     * @param {CoMySQL~onConnect} onConnect
     * @return {Promise}
     */
    getSlaveConnection(onConnect) {
        let pool = this._getPoolOf('SLAVE*', 'RANDOM');
        return this.__getConnection(pool, onConnect, false);
    }

    beginTransaction(onConnect) {
        let pool = this._getPoolOf('MASTER');
        return this.__getConnection(pool, onConnect, true);
    }


    /**
     * クエリを実行する
     * @param {string} sql
     * @param {*} [params]
     * @return {Promise}
     */
    query(sql, params) {
        return new Promise((resolve) => {
            return this.getMasterConnection(function * (conn) {
                let results = yield conn.query(sql, params);
                resolve(results);
            });
        });
    }

    /**
     * クエリを実行し、1レコードのみの結果を返す
     * @param {string} sql
     * @param {*} [params]
     * @return {Promise}
     */
    selectOne(sql, params) {
        return new Promise((resolve) => {
            return this.getMasterConnection(function * (conn) {
                let results = yield conn.selectOne(sql, params);
                resolve(results);
            });
        });
    }

    end() {
        this._pool.end((err) => {
            if (err) console.error(err);
        });
    }
}

class CoMySQLConnection {
    constructor(origConn) {
        this._conn = origConn;
    }

    /**
     * クエリを実行する
     * @param {string} sql
     * @param {*} [params]
     * @param {*} [next]
     * @return {Promise}
     */
    query(sql, params, next) {
        let stacktrace = new Stacktrace(); //呼び出し元追跡用
        return new Promise((resolve, reject) => {
            this._conn.query(sql, params || null, (err, results) => {
                if (err) {
                    return reject(stacktrace.error(err, [sql, params]));
                }
                if (next) results = next(results);
                resolve(results);
            });
        });
    }

    /**
     * クエリを実行し、1レコードのみの結果を返す
     * @param {string} sql
     * @param {*} [params]
     * @return {Promise}
     */
    selectOne(sql, params) {
        return this.query(sql, params, list => {
            if (list && list[0]) {
                return list[0];
            } else {
                return null;
            }
        });
    }

    rollback() {
        throw '__CoMySQL__rollback__';
    }
}

/**
 * co を使って generator を経由すると、Stacktrace が繋がらなくなる。
 * SQL の呼び出し元がわからないとデバッグしづらいので解るように、
 * 呼び出し時に（多少パフォーマンスを犠牲にして）Stacktraceを保持する。
 * 例外が発生したら、Stacktraceを差し替える。
 */
class Stacktrace extends Error {
    constructor() {
        super();
        // noinspection JSUnresolvedFunction
        Error.captureStackTrace(this, Stacktrace);
    }

    error(err, params) {
        let e = this;
        if (err instanceof Error) {
            e = err;
            e.stack += `\nmore${this.stack.replace(/^Error/, '')}`;
        } else {
            e.message = err;
        }
        // console.error(`err:${err}`);
        if (params) e.message += `  params: ${JSON.stringify(params)}`;
        // console.log(`stack:${}`);
        return e;
    }
}

module.exports = CoMySQL;
