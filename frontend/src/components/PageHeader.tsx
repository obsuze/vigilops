import { Row, Col, Typography, Space } from 'antd'
import type { ReactNode } from 'react'

const { Title } = Typography

interface PageHeaderProps {
  title: string
  subtitle?: string
  extra?: ReactNode
  tags?: ReactNode
}

export default function PageHeader({ title, subtitle, extra, tags }: PageHeaderProps) {
  return (
    <Row justify='space-between' align='middle' style={{ marginBottom: 16 }}>
      <Col>
        <Space align='center'>
          <Title level={4} style={{ margin: 0 }}>{title}</Title>
          {tags}
        </Space>
        {subtitle && <Typography.Text type='secondary' style={{ fontSize: 12 }}>{subtitle}</Typography.Text>}
      </Col>
      {extra && <Col>{extra}</Col>}
    </Row>
  )
}
