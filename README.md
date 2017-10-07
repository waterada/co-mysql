CoMySQL
=========
[![Build Status](https://travis-ci.org/waterada/co-mysql.svg?branch=master)](https://travis-ci.org/waterada/co-mysql)
[![Dependency Status](https://gemnasium.com/badges/github.com/waterada/co-mysql.svg)](https://gemnasium.com/github.com/waterada/co-mysql)
[![MIT License](http://img.shields.io/badge/license-MIT-blue.svg?style=flat)](LICENSE)


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

//Slaveで繋ぐなら
yield coMySQL.getSlaveConnection(function * (conn) {
    //ここでSQL
});

//トランザクションを使うなら
yield coMySQL.beginTransaction(function * (conn) {
    //ここでSQL
    if (isError) { //何か問題があれば
        conn.rollback();
    }
    //何もなければ自動的に commit される
});
```

- [`co`](https://www.npmjs.com/package/co) を使ってコールバック地獄にすることなく、Promise よりもシンプルに SQL を書ける。
- MASTER/SLAVE の Pooling とコネクションの取得・リリース処理はほぼ自動化され簡単に書ける（実質 `getMasterConnection()` で囲むだけ）。
- [`co`](https://www.npmjs.com/package/co) だと SQL エラーの stacktrace から SQL の呼び出し元を辿れないが、これは辿れる。



依存
-----

- `node 6.x` 以上
- `mysql`
- `co`


インストール
-------------

```sh
npm install --save @waterada/co-mysql
```

実装
---------

```js
//接続
const CoMySQL = require('@waterada/co-mysql');
const coMySQL = new CoMySQL({
  "COMMON": {
    "connectTimeout": 1000,
    "supportBigNumbers": true,
    "connectionLimit": 1,
    "removeNodeErrorCount": 3,
    "host": "mysql",
    "port": "3306"
  },
  "MASTER": {
    "user": "co_mysql_test",
    "password": "co_mysql_test",
    "database": "co_mysql_test"
  },
  "SLAVES": [
    {
      "user": "co_mysql_test",
      "password": "co_mysql_test",
      "database": "co_mysql_test"
    },
    {
      "user": "co_mysql_test",
      "password": "co_mysql_test",
      "database": "co_mysql_test"
    }
  ]
});

//コネクション取得
yield coMySQL.getMasterConnection(function * (conn) {
    //SQL実行
});

//終了
coMySQL.end();
```

詳細な使い方
------------

[テスト](test/test-co-mysql.js) を参考にしてください。


テスト実行方法
--------------

ローカルで動かす場合:

```sh
npm test
```

docker で動かす場合:

```sh
docker-compose run --rm node npm test
```
