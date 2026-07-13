import { supabase } from '@/lib/supabase'
import { DailySpark } from '@/components/daily-spark'

export default async function Page() {
  const { data: prompt } = await supabase
    .from('prompts')
    .select('*')
    .eq('published', true)
    .order('publish_date', { ascending: false })
    .limit(1)
    .single()

  return (
    <main>
      <DailySpark promptData={prompt} />
    </main>
  )
}