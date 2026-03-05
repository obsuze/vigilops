/**
 * 主机列表页面
 * 展示所有受监控主机的概览信息，支持表格和卡片两种视图模式，
 * 提供按状态筛选和按主机名搜索功能。
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Card, Tag, Input, Select, Row, Col, Progress, Typography, Space, Button, Segmented, Empty } from 'antd';
import { CloudServerOutlined, AppstoreOutlined, UnorderedListOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { hostService } from '../services/hosts';
import type { Host } from '../services/hosts';
import PageHeader from '../components/PageHeader';

const { Search } = Input;

/**
 * 主机列表组件
 * 支持分页查询、状态筛选、关键字搜索，以及表格/卡片视图切换
 */
export default function HostList() {
  const { t } = useTranslation();
  const [hosts, setHosts] = useState<Host[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<string>('table');
  const navigate = useNavigate();

  const fetchHosts = async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, page_size: pageSize };
      if (statusFilter) params.status = statusFilter;
      if (search) params.search = search;
      const { data } = await hostService.list(params);
      setHosts(data.items || []);
      setTotal(data.total || 0);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchHosts(); }, [page, pageSize, statusFilter, search]);

  const columns = [
    {
      title: t('hosts.hostname'), dataIndex: 'hostname', key: 'hostname',
      render: (text: string, record: Host) => (
        <Button type="link" onClick={() => navigate(`/hosts/${record.id}`)}>{text}</Button>
      ),
    },
    { title: t('hosts.ip'), dataIndex: 'ip_address', key: 'ip_address' },
    { title: t('hosts.os'), dataIndex: 'os', key: 'os' },
    {
      title: t('hosts.status'), dataIndex: 'status', key: 'status',
      render: (s: string) => {
        if (s === 'online') return <Tag color="success">{t('hosts.online')}</Tag>;
        if (s === 'offline') return <Tag color="error">{t('hosts.offline')}</Tag>;
        return <Tag>{t('common.unknown')}</Tag>;
      },
    },
    {
      title: t('hosts.cpu'), key: 'cpu',
      render: (_: unknown, record: Host) => record.latest_metrics ? (
        <Progress percent={Math.round(record.latest_metrics.cpu_percent)} size="small" status={record.latest_metrics.cpu_percent > 90 ? 'exception' : 'normal'} />
      ) : '-',
    },
    {
      title: t('hosts.memory'), key: 'mem',
      render: (_: unknown, record: Host) => record.latest_metrics ? (
        <Progress percent={Math.round(record.latest_metrics.memory_percent)} size="small" status={record.latest_metrics.memory_percent > 90 ? 'exception' : 'normal'} />
      ) : '-',
    },
    {
      title: t('hosts.disk'), key: 'disk',
      render: (_: unknown, record: Host) => record.latest_metrics ? (
        <Progress percent={Math.round(record.latest_metrics.disk_percent)} size="small" status={record.latest_metrics.disk_percent > 90 ? 'exception' : 'normal'} />
      ) : '-',
    },
    {
      title: t('hosts.tags'), dataIndex: 'tags', key: 'tags',
      render: (tags: Record<string, boolean> | string[] | null) => {
        if (!tags) return '-';
        const arr = Array.isArray(tags) ? tags : Object.keys(tags);
        return arr.map(tag => <Tag key={tag}>{tag}</Tag>);
      },
    },
  ];

  const cardView = (
    <Row gutter={[16, 16]}>
      {hosts.map(host => (
        <Col key={host.id} xs={24} sm={12} md={8} lg={6}>
          <Card
            hoverable
            onClick={() => navigate(`/hosts/${host.id}`)}
            size="small"
          >
            <Space direction="vertical" style={{ width: '100%' }}>
              <Space>
                <CloudServerOutlined style={{ fontSize: 20 }} />
                <Typography.Text strong>{host.hostname}</Typography.Text>
                <Tag color={host.status === 'online' ? 'success' : host.status === 'offline' ? 'error' : 'default'}>
                    {host.status === 'online' ? t('hosts.online') : host.status === 'offline' ? t('hosts.offline') : t('common.unknown')}
                  </Tag>
              </Space>
              <Typography.Text type="secondary">{host.ip_address}</Typography.Text>
              {host.latest_metrics && (
                <>
                  <div>CPU: <Progress percent={Math.round(host.latest_metrics.cpu_percent)} size="small" /></div>
                  <div>{t('hosts.memory')}: <Progress percent={Math.round(host.latest_metrics.memory_percent)} size="small" /></div>
                </>
              )}
            </Space>
          </Card>
        </Col>
      ))}
    </Row>
  );

  return (
    <div>
      <PageHeader
        title={t('hosts.title')}
        extra={
          <Space>
            <Search placeholder={t('hosts.searchPlaceholder')} onSearch={v => { setSearch(v); setPage(1); }} style={{ width: 200 }} allowClear />
            <Select placeholder={t('hosts.status')} allowClear style={{ width: 120 }} onChange={v => { setStatusFilter(v || ''); setPage(1); }}
              options={[{ label: t('hosts.online'), value: 'online' }, { label: t('hosts.offline'), value: 'offline' }]} />
            <Segmented options={[
              { value: 'table', icon: <UnorderedListOutlined /> },
              { value: 'card', icon: <AppstoreOutlined /> },
            ]} value={viewMode} onChange={v => setViewMode(v as string)} />
          </Space>
        }
      />
      {!loading && hosts.length === 0 && !search && !statusFilter ? (
        <Card>
          <Empty description={t('hosts.noServers')}>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/settings?tab=tokens')}>{t('hosts.addServer')}</Button>
          </Empty>
        </Card>
      ) : viewMode === 'table' ? (
        <Table
          dataSource={hosts}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ current: page, pageSize, total, onChange: (p, ps) => { setPage(p); setPageSize(ps); } }}
        />
      ) : cardView}
    </div>
  );
}
