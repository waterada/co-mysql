const CoMySQL = require('../lib/co-mysql')._CoMySQL;
const coMocha = require('./lib/co-mocha');
const assert = require('chai').assert;
const config = require('config');

const __createDb = function () {
    let coMySQL = new CoMySQL(config['MYSQL']);
    after(() => coMySQL.end());
    return coMySQL;
};

class ConnCount {
    constructor(coMySQL, clusterRegExp) {
        this.coMySQL = coMySQL;
        this.clusterRegExp = clusterRegExp;
    }
    __getFreePerAll() {
        let free = 0;
        let all = 0;
        Object.keys(this.coMySQL._pool._nodes).filter(c => c.match(this.clusterRegExp)).forEach(c => {
            let pool = this.coMySQL._pool._nodes[c].pool;
            all += pool._allConnections.length;
            free += pool._freeConnections.length;
        });
        return { free, all };
    }
    assertFreePerAll(expected, msg) {
        let data = this.__getFreePerAll();
        let actual = `${data.free}/${data.all}`;
        assert.equal(actual, expected, `${msg} (Free/All)`);
    }
    assertUsed(expected, msg) {
        let data = this.__getFreePerAll();
        assert.equal(data.all - data.free, expected, `${msg} (Free)`);
    }
}

describe('CoMySQL', function () {

    describe('代表的な使い方', function () {
        let coMySQL = __createDb();

        it('コネクション取得できる', coMocha.wrap(function * () {
            let connCount = new ConnCount(coMySQL, /^MASTER/);
            connCount.assertFreePerAll('0/0', 'はじめはコネクション無い');
            // noinspection JSUnusedLocalSymbols
            yield coMySQL.getMasterConnection(function * (conn) {
                connCount.assertFreePerAll('0/1', '初回にコネクションが生成されて使われる');
                assert.isOk(true, 'ここでSQL実行する')
            });
            connCount.assertFreePerAll('1/1', 'コネクションは自動的に開放される');
        }));

        it('Master コネクション取得して SQL 実行', coMocha.wrap(function * () {
            yield coMySQL.getMasterConnection(function * (conn) {
                //全削除
                {
                    yield conn.query('TRUNCATE TABLE users');
                    let users = yield conn.query('SELECT * FROM users');
                    assert.equal(users.length, 0);
                }
                //追加
                {
                    let res1 = yield conn.query('INSERT INTO users (user_name) values (?)', ['aaa']);
                    let res2 = yield conn.query('INSERT INTO users (user_name) values (?)', ['bbb']);
                    assert.equal(res1.insertId, 1);
                    assert.equal(res2.insertId, 2);
                }
                //複数行取得
                {
                    let users = yield conn.query('SELECT * FROM users');
                    assert.equal(users.length, 2);
                    assert.equal(users[0]['user_id'], 1);
                    assert.equal(users[1]['user_id'], 2);
                    assert.equal(users[0]['user_name'], 'aaa');
                    assert.equal(users[1]['user_name'], 'bbb');
                }
                //複数行変更
                {
                    let res = yield conn.query('UPDATE users SET user_name=?', ['aaa']);
                    assert.equal(res.affectedRows, 2, '対象は全件');
                    assert.equal(res.changedRows, 1, '実際の変更は１件');
                    let users = yield conn.query('SELECT * FROM users ORDER BY user_id');
                    assert.equal(users.length, 2);
                    assert.equal(users[0]['user_name'], 'aaa');
                    assert.equal(users[1]['user_name'], 'aaa');
                }
                //単一行変更
                {
                    let res = yield conn.query('UPDATE users SET user_name=? WHERE user_id=?', ['ccc', 1]);
                    assert.equal(res.affectedRows, 1);
                    assert.equal(res.changedRows, 1);
                    let users = yield conn.query('SELECT * FROM users ORDER BY user_id');
                    assert.equal(users.length, 2);
                    assert.equal(users[0]['user_name'], 'ccc');
                    assert.equal(users[1]['user_name'], 'aaa');
                }
                //単一行取得
                {
                    let user = yield conn.selectOne('SELECT * FROM users WHERE user_id=?', [1]);
                    assert.equal(user['user_name'], 'ccc');
                }
            });
        }));

        const __initDb = function * (coMySQL) {
            yield coMySQL.getMasterConnection(function * (conn) {
                //全削除
                {
                    yield conn.query('TRUNCATE TABLE users');
                    let users = yield conn.query('SELECT * FROM users');
                }
                //追加
                {
                    yield conn.query('INSERT INTO users (user_name) values (?)', ['aaa']);
                    yield conn.query('INSERT INTO users (user_name) values (?)', ['bbb']);
                }
            });
        };

        it('Slave コネクション取得して SQL 実行', coMocha.wrap(function * () {
            yield __initDb(coMySQL);
            yield coMySQL.getSlaveConnection(function * (conn) {
                let user = yield conn.selectOne('SELECT * FROM users WHERE user_id=?', [1]);
                assert.equal(user['user_name'], 'aaa');
            });
        }));

        describe('トランザクションモードで SQL 実行', function () {

            it('何もしなければコミットされる', coMocha.wrap(function * () {
                yield __initDb(coMySQL);
                yield coMySQL.beginTransaction(function * (conn) {
                    //更新
                    yield conn.query('UPDATE users SET user_name=? WHERE user_id=?', ['zzz', 1]);
                    //確認
                    let user = yield conn.selectOne('SELECT * FROM users WHERE user_id=?', [1]);
                    assert.equal(user['user_name'], 'zzz', '更新されている');
                });
                yield coMySQL.getMasterConnection(function * (conn) {
                    let user = yield conn.selectOne('SELECT * FROM users WHERE user_id=?', [1]);
                    assert.equal(user['user_name'], 'zzz', 'Commitされている');
                });
            }));

            it('強制エラーによりロールバック（例外は外にも透過する）', coMocha.wrap(function * () {
                yield __initDb(coMySQL);
                let thrown = yield coMocha.catchThrown(function * () {
                    yield coMySQL.beginTransaction(function * (conn) {
                        //更新
                        yield conn.query('UPDATE users SET user_name=? WHERE user_id=?', ['zzz', 1]);
                        //確認
                        let user = yield conn.selectOne('SELECT * FROM users WHERE user_id=?', [1]);
                        assert.equal(user['user_name'], 'zzz', '更新されている');
                        //Rollback
                        throw '強制エラー';
                    });
                });
                thrown.assertThrows('強制エラー', '中で発生したエラーは外まで透過する');
                thrown.assertExistsInStack(__filename, { line: -11 });
                yield coMySQL.getMasterConnection(function * (conn) {
                    //確認
                    let user = yield conn.selectOne('SELECT * FROM users WHERE user_id=?', [1]);
                    assert.equal(user['user_name'], 'aaa', 'Rollbackされてもとに戻っている');
                });
            }));

            it('rollback() によりロールバック（即終了するが例外を外に投げない）', coMocha.wrap(function * () {
                yield __initDb(coMySQL);
                yield coMySQL.beginTransaction(function * (conn) {
                    //更新
                    yield conn.query('UPDATE users SET user_name=? WHERE user_id=?', ['zzz', 1]);
                    //確認
                    let user = yield conn.selectOne('SELECT * FROM users WHERE user_id=?', [1]);
                    assert.equal(user['user_name'], 'zzz', '更新されている');
                    //Rollback
                    conn.rollback();
                    assert.fail('ここは通らない');
                });
                yield coMySQL.getMasterConnection(function * (conn) {
                    //確認
                    let user = yield conn.selectOne('SELECT * FROM users WHERE user_id=?', [1]);
                    assert.equal(user['user_name'], 'aaa', 'Rollbackされてもとに戻っている');
                });
            }));
        });

        describe('レコード取得の都度、 Master コネクションを取得して開放することもできる ※楽だが効率は悪い', function () {
            let coMySQL = __createDb();
            it('query()直', coMocha.wrap(function * () {
                let results = yield coMySQL.query('SELECT * FROM users');
                assert.isAbove(results.length, 0);
            }));
            it('selectOne()直', coMocha.wrap(function * () {
                let result = yield coMySQL.selectOne('SELECT * FROM users');
                assert.isAbove(result['user_id'], 0);
            }));
        });
    });

    describe('coMySQL.end()', function () {
        it('DBを使い終わえたらDBを終了させること(DBが終了していないとプログラムが終了しない)', coMocha.wrap(function * () {
            let coMySQL = __createDb();
            //Pool済みに
            yield coMySQL.getMasterConnection(function * (conn) {});
            for (let i = 0; i < 20; i++) yield coMySQL.getSlaveConnection(function * (conn) {}); //沢山回して両SlaveがPool済みになるように
            new ConnCount(coMySQL, /^MASTER/).assertFreePerAll('1/1', 'コネクションが存在する');
            new ConnCount(coMySQL, /^SLAVE/).assertFreePerAll('2/2', 'コネクションが存在する');
            //終了
            coMySQL.end();
            //確認
            new ConnCount(coMySQL, /^MASTER/).assertFreePerAll('0/0', 'コネクションはすべてcloseされる');
            new ConnCount(coMySQL, /^SLAVE/).assertFreePerAll('0/0', 'コネクションはすべてcloseされる');
            //コネクションを再度繋ぎに行けばエラーになる
            (yield coMocha.catchThrown(function * () {
                yield coMySQL.getMasterConnection(function * (conn) {});
            })).assertThrows('Pool is closed').assertExistsInStack(__filename, { line: -1 });
        }));
    });

    describe('throw したエラーの発生元の行番号', function () {
        let coMySQL = __createDb();

        it('文字列を throw したなら getMasterConnection などコネクション取得を呼んだ行', coMocha.wrap(function * () {
            let thrown = yield coMocha.catchThrown(function * () {
                yield coMySQL.getMasterConnection(function * () {
                    throw '文字列を throw';
                });
            });
            thrown.assertThrows('文字列を throw');
            thrown.assertExistsInStack(__filename, { line: -5 }, 'getMasterConnection の行が取れる');
        }));

        it('Error を throw したなら throw した行', coMocha.wrap(function * () {
            let thrown = yield coMocha.catchThrown(function * () {
                yield coMySQL.getMasterConnection(function * () {
                    throw new Error('Error を throw');
                });
            });
            thrown.assertThrows('Error を throw');
            thrown.assertExistsInStack(__filename, { line: -4 }, 'throw した行が取れる');
        }));
    });

    describe('詳細: コネクションの取得・開放', function () {
        let coMySQL = __createDb();
        it(`getMasterConnection`, coMocha.wrap(function * () {
            let connCount = new ConnCount(coMySQL, /^MASTER/);
            connCount.assertFreePerAll('0/0', 'はじめは無い');
            yield coMySQL.getMasterConnection(function * (conn) {
                connCount.assertFreePerAll('0/1', '生成されて使われる');
                assert.equal(conn._conn._clusterId, 'MASTER');
            });
            connCount.assertFreePerAll('1/1', '再び空く');
            yield coMySQL.getMasterConnection(function * () {
                connCount.assertFreePerAll('0/1', '使われる');
            });
            connCount.assertFreePerAll('1/1', '再び空く');
            (yield coMocha.catchThrown(function * () {
                yield coMySQL.getMasterConnection(function * () {
                    connCount.assertFreePerAll('0/1', '使われる');
                    throw new Error('エラー発生');
                });
            })).assertThrows('エラー発生').assertExistsInStack(__filename, { line: -2 });
            (yield coMocha.catchThrown(function * () {
                yield coMySQL.getMasterConnection(function * (conn) {
                    connCount.assertFreePerAll('0/1', '使われる');
                    yield conn.query('SQLエラー');
                });
            })).assertThrows('ER_PARSE_ERROR: You have an error in your SQL syntax').assertExistsInStack(__filename, { line: -2 });
            connCount.assertFreePerAll('1/1', '再び空く');
        }));
        it(`getSlaveConnection`, coMocha.wrap(function * () {
            let connCount = new ConnCount(coMySQL, /^SLAVE/);
            connCount.assertFreePerAll('0/0', 'はじめは無い');
            yield coMySQL.getSlaveConnection(function * (conn) {
                connCount.assertFreePerAll('0/1', '生成されて使われる');
                assert.match(conn._conn._clusterId, /^SLAVE/);
            });
            connCount.assertFreePerAll('1/1', '再び空く');
            for (let i = 0; i < 20; i++) { //ランダムで SLAVE1, SLAVE2 が選ばれるので両方１度は選ばれるように沢山回繰り返す
                yield coMySQL.getSlaveConnection(function * () {});
            }
            connCount.assertFreePerAll('2/2', 'SLAVE1, SLAVE2 両方が生成されている');
            yield coMySQL.getSlaveConnection(function * () {
                connCount.assertFreePerAll('1/2', '新たに生成される');
            });
            connCount.assertFreePerAll('2/2', '再び空く');
            yield coMySQL.getSlaveConnection(function * () {
                connCount.assertFreePerAll('1/2', '使われる');
            });
            connCount.assertFreePerAll('2/2', '再び空く');
        }));
        it(`beginTransaction`, coMocha.wrap(function * () {
            let connCount = new ConnCount(coMySQL, /^MASTER/);
            connCount.assertFreePerAll('1/1', 'すでに  getMasterConnection してるので存在する');
            yield coMySQL.beginTransaction(function * (conn) {
                connCount.assertFreePerAll('0/1', '使われる');
                assert.equal(conn._conn._clusterId, 'MASTER');
            });
            connCount.assertFreePerAll('1/1', '再び空く');
        }));
        it(`エラーでも開放される`, coMocha.wrap(function * () {
            let connCount = new ConnCount(coMySQL, /^MASTER/);
            connCount.assertFreePerAll('1/1', '空いている');
            (yield coMocha.catchThrown(function * () {
                yield coMySQL.getMasterConnection(function * () {
                    connCount.assertFreePerAll('0/1', '使われる');
                    throw new Error('エラー発生');
                });
            })).assertThrows('エラー発生').assertExistsInStack(__filename, { line: -2 });
            connCount.assertFreePerAll('1/1', '再び空く');
            (yield coMocha.catchThrown(function * () {
                yield coMySQL.getMasterConnection(function * (conn) {
                    connCount.assertFreePerAll('0/1', '使われる');
                    yield conn.query('SQLエラー');
                });
            })).assertThrows('ER_PARSE_ERROR: You have an error in your SQL syntax').assertExistsInStack(__filename, { line: -2 });
            connCount.assertFreePerAll('1/1', '再び空く');
            //トランザクション
            (yield coMocha.catchThrown(function * () {
                yield coMySQL.beginTransaction(function * () {
                    connCount.assertFreePerAll('0/1', '使われる');
                    throw new Error('エラー発生');
                });
            })).assertThrows('エラー発生').assertExistsInStack(__filename, { line: -2 });
            (yield coMocha.catchThrown(function * () {
                yield coMySQL.beginTransaction(function * (conn) {
                    connCount.assertFreePerAll('0/1', '使われる');
                    yield conn.query('SQLエラー');
                });
            })).assertThrows('ER_PARSE_ERROR: You have an error in your SQL syntax').assertExistsInStack(__filename, { line: -2 });
            connCount.assertFreePerAll('1/1', '再び空く');
        }));
    });

    describe('詳細: 特殊なエラー処理', function () {
        it('コネクション取得でエラー発生した場合、例外が外に投げられる', coMocha.wrap(function * () {
            let coMySQL = __createDb();
            //強制エラー化
            coMySQL.__rewriteResOfGetConn = (err, conn) => {
                conn.release(); //このコネクションはなかったことにする
                return ['コネクション取得で強制的にエラー', null];
            };
            //エラーが投げられる
            (yield coMocha.catchThrown(function * () {
                //コネクション取得
                yield coMySQL.getMasterConnection(function * () {
                    assert.fail('ここは実行されない');
                });
            })).assertThrows('コネクション取得で強制的にエラー').assertExistsInStack(__filename, { line: -3 });
        }));

        it('beginTransactionでエラー発生した場合、コネクション消費せず、エラー終了する', coMocha.wrap(function * () {
            let coMySQL = __createDb();
            //強制エラー化
            coMySQL.__rewriteResOfGetConn = (err, conn) => {
                conn.beginTransaction = (cb) => {
                    cb('beginTransactionで強制的にエラー');
                };
                return [null, conn];
            };
            //エラーが投げられる
            (yield coMocha.catchThrown(function * () {
                //トランザクション開始
                yield coMySQL.beginTransaction(function * () {
                    assert.fail('ここは実行されない');
                });
            })).assertThrows('beginTransactionで強制的にエラー').assertExistsInStack(__filename, { line: -3 });
            new ConnCount(coMySQL, /^MASTER/).assertUsed(0, 'コネクションは使われていない');
        }));
    });
});
