CoMySQL
=========
[![Build Status](https://travis-ci.org/waterada/co-mysql.svg?branch=master)](https://travis-ci.org/waterada/co-mysql)


概要
------

SQL を下記のように書けるようにするもの。

```js
yield coMySQL.getMasterConnection(function * (conn) {
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
```

ようするに、[`co`](https://www.npmjs.com/package/co) を使うことでコールバック地獄にすることなく、Promise よりもシンプルに SQL を書けるようにするのに加えて、MASTER/SLAVE の Pooling とコネクションの取得・リリース処理を簡単に書けるようにし（実質 `getMasterConnection()` で囲むだけ）、`co` の最大のデメリットであるエラー時の stacktrace から SQL の呼び出し元を辿れない問題を解決しました。

テスト実行方法
--------------

```sh
docker-compose run --rm node npm test
```
