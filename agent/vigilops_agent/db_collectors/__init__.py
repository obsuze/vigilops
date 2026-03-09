"""
数据库采集器插件包。

导入所有采集器以触发自动注册（AbstractDBCollector._registry）。
新增采集器只需在此处 import 即可加入分派体系。
"""
from vigilops_agent.db_collectors.postgres import PostgreSQLCollector
from vigilops_agent.db_collectors.mysql import MySQLCollector
from vigilops_agent.db_collectors.oracle import OracleCollector
from vigilops_agent.db_collectors.redis import RedisCollector

__all__ = [
    "PostgreSQLCollector",
    "MySQLCollector",
    "OracleCollector",
    "RedisCollector",
]
