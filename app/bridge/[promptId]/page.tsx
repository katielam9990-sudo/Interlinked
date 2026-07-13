export const dynamic = 'force-dynamic'

import { supabase } from '@/lib/supabase'
import { DailySpark } from '@/components/daily-spark'

export default async function Page({ params }: { params: Promise<{ promptId: string }> }) {
  const { promptId } = await params

  const { data: prompt } = await supabase
    .from('prompts')
    .select('*')
    .eq('id', promptId)
    .single()

  return (
    <main>
      <DailySpark promptData={prompt} skipIntro />
    </main>
  )
}