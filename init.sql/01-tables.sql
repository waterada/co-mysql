USE `co_mysql_test`;

DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `user_id` INT UNSIGNED auto_increment PRIMARY KEY,
  `user_name`  VARCHAR(100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
