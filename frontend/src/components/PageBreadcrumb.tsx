import { Breadcrumb } from 'antd'
import { Link } from 'react-router-dom'
interface BreadcrumbItem { label: string; path?: string }
export default function PageBreadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <Breadcrumb style={{ marginBottom: 16 }}
      items={items.map((item, i) => ({
        key: i,
        title: item.path && i < items.length - 1
          ? <Link to={item.path}>{item.label}</Link>
          : item.label
      }))}
    />
  )
}
