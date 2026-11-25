import { Spiral } from '@/components/art/Decor'
import { ButtonLink, Container } from '@/components/ui'

export default function NotFound() {
  return (
    <Container narrow className="py-24 text-center">
      <Spiral className="mx-auto h-20 w-20 text-ochre" />
      <h1 className="mt-6 text-4xl text-ink sm:text-5xl">This one collapsed on the wheel.</h1>
      <p className="mt-4 text-lg text-ink-soft">
        We couldn’t find that page. It happens to the best of us.
      </p>
      <ButtonLink href="/workshops" className="mt-8" size="lg">
        Browse workshops
      </ButtonLink>
    </Container>
  )
}
