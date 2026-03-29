/**
 * Prometheus 告警 AI 诊断 Demo 页面
 * 无需认证，展示 SSE 实时告警诊断流
 */
import { useEffect, useRef, useState } from 'react';
import { Card, Tag, Typography, Button, Alert, Space, Empty, Badge, message } from 'antd';
import { CopyOutlined, LinkOutlined, DisconnectOutlined, LoadingOutlined } from '@ant-design/icons';

const { Title, Text, Paragraph } = Typography;

interface DiagnosisEvent {
  alertname: string;
  instance: string;
  severity: string;
  summary: string;
  diagnosis: {
    root_cause?: string;
    confidence?: number;
    evidence?: string[];
    recommendations?: string[];
  };
  timestamp: string | null;
  alert_id: number | null;
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'red',
  warning: 'orange',
  info: 'blue',
};

const CONFIG_SNIPPET = `# alertmanager.yml
receivers:
  - name: 'vigilops'
    webhook_configs:
      - url: '${window.location.protocol}//${window.location.hostname}:8001/api/v1/webhooks/alertmanager'
        send_resolved: true
        http_config:
          authorization:
            type: Bearer
            credentials: 'YOUR_TOKEN_HERE'

route:
  receiver: 'vigilops'`;

export default function Demo() {
  const [events, setEvents] = useState<DiagnosisEvent[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const apiBase = `${window.location.protocol}//${window.location.hostname}:8001`;
    const sseUrl = `${apiBase}/api/v1/demo/alerts/stream`;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      const es = new EventSource(sseUrl);
      eventSourceRef.current = es;

      es.addEventListener('connected', () => setStatus('connected'));
      es.addEventListener('diagnosis', (e) => {
        try {
          const data: DiagnosisEvent = JSON.parse(e.data);
          setEvents((prev) => [data, ...prev].slice(0, 100));
        } catch {
          // ignore parse errors
        }
      });

      es.onerror = () => {
        setStatus('error');
        es.close();
        reconnectTimer = setTimeout(() => {
          setStatus('connecting');
          connect();
        }, 5000);
      };
    }

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      eventSourceRef.current?.close();
    };
  }, []);

  const handleCopy = () => {
    navigator.clipboard.writeText(CONFIG_SNIPPET).then(() => {
      message.success('已复制到剪贴板');
    });
  };

  const statusBadge = {
    connecting: { status: 'processing' as const, text: '连接中...' },
    connected: { status: 'success' as const, text: '已连接' },
    disconnected: { status: 'default' as const, text: '已断开' },
    error: { status: 'error' as const, text: '连接错误' },
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px' }}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div style={{ textAlign: 'center' }}>
          <Title level={2} style={{ marginBottom: 4 }}>
            VigilOps Prometheus 告警 AI 诊断
          </Title>
          <Text type="secondary">
            连接你的 AlertManager，2 分钟内看到 AI 根因分析
          </Text>
        </div>

        <Card
          title="AlertManager 配置"
          extra={
            <Button icon={<CopyOutlined />} onClick={handleCopy} size="small">
              复制
            </Button>
          }
        >
          <Alert
            type="info"
            showIcon
            message="在服务器上设置 ALERTMANAGER_WEBHOOK_TOKEN 环境变量，然后将相同的值填入下方配置的 credentials 字段"
            style={{ marginBottom: 12 }}
          />
          <pre
            style={{
              background: '#f5f5f5',
              padding: 16,
              borderRadius: 6,
              fontSize: 13,
              overflow: 'auto',
              margin: 0,
            }}
          >
            {CONFIG_SNIPPET}
          </pre>
        </Card>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Title level={4} style={{ margin: 0 }}>
            实时告警诊断
          </Title>
          <Badge
            status={statusBadge[status].status}
            text={statusBadge[status].text}
          />
        </div>

        {events.length === 0 ? (
          <Empty
            description={
              status === 'connected'
                ? '等待告警... 配置 AlertManager 后，告警将在这里实时显示'
                : '正在连接服务器...'
            }
            image={
              status === 'connected' ? (
                <LinkOutlined style={{ fontSize: 48, color: '#bfbfbf' }} />
              ) : status === 'error' || status === 'disconnected' ? (
                <DisconnectOutlined style={{ fontSize: 48, color: '#ff4d4f' }} />
              ) : (
                <LoadingOutlined style={{ fontSize: 48, color: '#1677ff' }} />
              )
            }
          />
        ) : (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            {events.map((evt, idx) => (
              <Card
                key={`${evt.alertname}-${evt.timestamp}-${idx}`}
                size="small"
                title={
                  <Space>
                    <Tag color={SEVERITY_COLORS[evt.severity] || 'default'}>
                      {evt.severity}
                    </Tag>
                    <Text strong>{evt.alertname}</Text>
                    <Text type="secondary">{evt.instance}</Text>
                  </Space>
                }
                extra={
                  evt.timestamp && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {new Date(evt.timestamp).toLocaleString('zh-CN')}
                    </Text>
                  )
                }
              >
                {evt.summary && (
                  <Paragraph type="secondary" style={{ marginBottom: 8 }}>
                    {evt.summary}
                  </Paragraph>
                )}

                {evt.diagnosis?.root_cause && (
                  <div style={{ marginBottom: 8 }}>
                    <Text strong>根因分析: </Text>
                    <Text>{evt.diagnosis.root_cause}</Text>
                    {evt.diagnosis.confidence != null && (
                      <Tag
                        color={evt.diagnosis.confidence >= 0.8 ? 'green' : evt.diagnosis.confidence >= 0.5 ? 'orange' : 'red'}
                        style={{ marginLeft: 8 }}
                      >
                        置信度 {Math.round(evt.diagnosis.confidence * 100)}%
                      </Tag>
                    )}
                  </div>
                )}

                {evt.diagnosis?.recommendations && evt.diagnosis.recommendations.length > 0 && (
                  <div>
                    <Text strong>建议: </Text>
                    <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                      {evt.diagnosis.recommendations.map((rec, i) => (
                        <li key={i}>
                          <Text>{rec}</Text>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>
            ))}
          </Space>
        )}

        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            VigilOps — 开源 AI 运维平台 | 自托管，数据不出境
          </Text>
        </div>
      </Space>
    </div>
  );
}
