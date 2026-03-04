import { RobotOutlined } from '@ant-design/icons'
import { Tag } from 'antd'
export default function AIBadge({ text = 'AI' }: { text?: string }) {
  return <Tag icon={<RobotOutlined />} color='cyan'>{text}</Tag>
}
