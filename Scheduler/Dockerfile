FROM ubuntu:rolling AS extractor
WORKDIR /extractions
COPY philbot-scheduler.gemspec ./
RUN cat philbot-scheduler.gemspec | grep 'version' | awk -F\' '{print $2}' > version.txt


FROM ruby:3.4.5
WORKDIR /application

COPY --from=extractor /extractions/version.txt ./
COPY Gemfile ./
RUN bundle install
COPY ./lib/* ./

CMD exec ruby scheduler.rb
